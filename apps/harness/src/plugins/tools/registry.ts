import type { Context } from 'cordis';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AgentTool, ToolService } from '../../core/tools/tool.js';
import type { ToolContext } from '../../core/tools/tool-context.js';
import type { AuditLog, ToolDescriptor } from '../../core/tools/tool.types.js';
import { ToolAuditError } from '../../core/tools/tool-audit-error.js';
import { AppError, checkAbort } from '../../core/errors.js';
interface Registered {
  descriptor: ToolDescriptor;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
}
export class ToolRegistry implements ToolService {
  private registry = new Map<string, Registered>();
  constructor(
    private audit: Context['storage']['audit'],
    private telemetry: Context['telemetry'],
  ) {}
  register<I, O>(tool: AgentTool<I, O>): () => void {
    if (this.registry.has(tool.name))
      throw new AppError('DUPLICATE_TOOL', `工具 ${tool.name} 已注册。`);
    const entry: Registered = {
      descriptor: {
        name: tool.name,
        description: tool.description,
        permission: tool.permission,
        kind: tool.kind,
        parameters: z.toJSONSchema(tool.inputSchema),
      },
      execute: async (input, context) => tool.execute(tool.inputSchema.parse(input), context),
    };
    this.registry.set(tool.name, entry);
    return () => {
      if (this.registry.get(tool.name) === entry) this.registry.delete(tool.name);
    };
  }
  get(name: string) {
    return this.registry.get(name)?.descriptor;
  }
  list() {
    return [...this.registry.values()].map((row) => row.descriptor);
  }
  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const entry = this.registry.get(name);
    if (!entry) throw new AppError('UNKNOWN_TOOL', '工具不存在。', 400);
    let status: 'completed' | 'failed' | 'denied' = 'failed';
    let output: unknown;
    let executionError: unknown;
    try {
      checkAbort(context.signal);
      if (!context.principal.permissions.includes(entry.descriptor.permission)) {
        status = 'denied';
        throw new AppError('TOOL_FORBIDDEN', '当前身份没有执行此工具的权限。', 403);
      }
      output = await this.telemetry.span(
        'tool.execute',
        { run_id: context.state.runId, tool: name },
        () => entry.execute(input, context),
      );
      if (Buffer.byteLength(JSON.stringify(output) ?? '') > 64000)
        throw new AppError('TOOL_OUTPUT_TOO_LARGE', '工具返回内容过大。');
      checkAbort(context.signal);
      status = 'completed';
    } catch (error) {
      executionError = error;
    }
    const audit: AuditLog = {
      id: randomUUID(),
      runId: context.state.runId,
      tenantId: context.principal.tenantId,
      userId: context.principal.userId,
      tool: name,
      permission: entry.descriptor.permission,
      status,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.audit(audit);
    } catch (cause) {
      this.telemetry.log(
        { event: 'tool.audit_failed', run_id: audit.runId, tool: name, status },
        'tool audit unavailable; execution requires reconciliation',
      );
      throw new ToolAuditError(audit, status === 'completed' ? output : undefined, cause);
    }
    if (status !== 'completed') throw executionError;
    return output;
  }
}

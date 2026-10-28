import { AppError } from '../errors.js';
import type { AuditLog } from './tool.types.js';

/** Audit persistence failed; end this run without retrying the action. */
export class ToolAuditError extends AppError {
  constructor(
    readonly audit: AuditLog,
    readonly result: unknown,
    cause: unknown,
  ) {
    super('TOOL_AUDIT_FAILED', '工具执行结果未能完成审计，请核对结果后再继续，勿直接重试。', 503);
    this.cause = cause;
  }
}

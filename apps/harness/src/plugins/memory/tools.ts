import type { Context } from 'cordis';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';

const memoryTool = { kind: 'memory', permission: 'READ' } as const;
const category = z.enum(['preference', 'fact', 'device', 'history']);

export const memoryToolPlugin = {
  name: 'memory-tools',
  inject: ['tools', 'memory'],
  apply(ctx: Context) {
    ctx.effect(() =>
      ctx.tools.register({
        ...memoryTool,
        name: 'memory_search',
        description:
          '个人偏好或过往信息与本轮问题相关时，用简短关键词检索当前用户的记忆。结果仅供个人参考。仅回答个人记忆时，用 ask_user 说明结果。',
        inputSchema: z.object({ query: z.string().trim().min(1).max(2000) }).strict(),
        async execute({ query }, { principal, signal }) {
          const { tenantId, userId } = principal;
          const rows = await ctx.memory.recall(query, { tenantId, userId, limit: 5, signal });
          return {
            memories: rows
              .filter((row) => row.tenantId === tenantId && row.userId === userId)
              .slice(0, 5)
              .map(({ id, content, category }) => ({
                id,
                content: content.slice(0, 1000),
                category,
              })),
          };
        },
      }),
    );
    // The READ role can manage its own memory when the current user message authorizes it.
    ctx.effect(() =>
      ctx.tools.register({
        ...memoryTool,
        name: 'memory_add',
        description:
          '仅在本轮用户以「请记住：内容」或 /remember 内容 明确请求时写入。服务端读取原文；成功后用 ask_user 确认保存。',
        inputSchema: z.object({ category: category.optional() }).strict(),
        async execute(input, { message, principal: { tenantId, userId }, state }) {
          const content = message
            ?.trim()
            .match(/^(?:\/remember\s+|(?:请)?记住[：:]\s*)([\s\S]+)$/u)?.[1];
          if (!content || content.length > 1000)
            throw new AppError(
              'MEMORY_CONSENT_REQUIRED',
              '请用「请记住：内容」指定要保存的内容（最多 1000 字）。',
              400,
            );
          if (
            state.toolCalls.some(
              (call) => call.tool === 'memory_add' && call.status === 'completed',
            )
          )
            throw new AppError('MEMORY_ALREADY_SAVED', '此轮已保存该条记忆。', 409);
          const item = await ctx.memory.remember({
            tenantId,
            userId,
            content,
            category: input.category ?? 'fact',
          });
          return { id: item.id };
        },
      }),
    );
    ctx.effect(() =>
      ctx.tools.register({
        ...memoryTool,
        name: 'memory_forget',
        description:
          '仅在本轮用户以「请忘记：记忆 ID」或 /forget ID 明确指定 ID 时处理。成功后用 ask_user 告知请求已处理。',
        inputSchema: z.object({}).strict(),
        async execute(_input, { message, principal: { tenantId, userId } }) {
          const id = message
            ?.trim()
            .match(/^(?:\/forget\s+|(?:请)?忘记[：:]\s*)(\S{1,256})$/u)?.[1];
          if (!id)
            throw new AppError(
              'MEMORY_CONSENT_REQUIRED',
              '请用「请忘记：记忆 ID」指定要遗忘的记录。',
              400,
            );
          await ctx.memory.forget(id, { tenantId, userId });
          return { processed: true };
        },
      }),
    );
  },
};

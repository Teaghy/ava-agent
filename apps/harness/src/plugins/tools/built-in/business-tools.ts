import type { Context } from 'cordis';
import { z } from 'zod';

import { checkAbort } from '../../../core/errors.js';
export const mockBusinessToolsPlugin = {
  name: 'mock-business-tools',
  inject: ['tools'],
  apply(ctx: Context) {
    for (const name of ['device_query', 'device_status', 'ticket_query']) {
      ctx.effect(() =>
        ctx.tools.register({
          name,
          description: `Mock Provider: ${name}，仅演示数据。`,
          permission: 'READ',
          inputSchema: z.object({ id: z.string().min(1).max(100) }).strict(),
          async execute(input, context) {
            checkAbort(context.signal);
            return {
              mock: true,
              id: input.id,
              owner: context.principal.userId,
              model: 'VCD-2000',
              status: name === 'device_status' ? 'E102' : 'available',
            };
          },
        }),
      );
    }
    for (const name of ['create_ticket', 'human_handoff']) {
      ctx.effect(() =>
        ctx.tools.register({
          name,
          description: `Mock Provider: ${name}，需要 WRITE 权限。`,
          permission: 'WRITE',
          inputSchema: z.object({ description: z.string().min(5).max(2000) }).strict(),
          async execute(_input, context) {
            checkAbort(context.signal);
            return {
              mock: true,
              ticketId: `MOCK-${context.state.runId}`,
              status: name === 'create_ticket' ? 'created' : 'handoff_requested',
            };
          },
        }),
      );
    }
  },
};

import { z } from 'zod';
import {
  AppError,
  checkAbort,
  type AnswerPolicy,
  type DecisionService,
  type HarnessOptions,
  type HarnessPlugin,
  type Principal,
  type RagRequest,
  type RetrievedDocument,
} from '@ava/harness/plugin';

export interface Order {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
}
/** Implement these adapters with your business API and retrieval algorithm. */
export interface RetailServices {
  lookupOrder(id: string, principal: Principal, signal: AbortSignal): Promise<Order | undefined>;
  searchKnowledge(request: RagRequest): Promise<RetrievedDocument[]>;
  reviewAnswer?: AnswerPolicy['validate'];
}

const orderResult = z.object({ id: z.string(), status: z.string() }).strict();
function createRetailExtension(services: RetailServices): HarnessPlugin {
  return {
    name: 'retail-capabilities',
    inject: ['tools', 'knowledge', 'guard'],
    apply(ctx) {
      ctx.effect(() =>
        ctx.knowledge.register({
          name: 'retail',
          description: '零售配送与售后政策',
          default: false,
          search: (request) => services.searchKnowledge(request),
        }),
      );
      ctx.effect(() =>
        ctx.tools.register({
          name: 'order_lookup',
          description: '查询当前用户自己的订单状态。',
          permission: 'READ',
          inputSchema: z.object({ id: z.string().min(1).max(100) }).strict(),
          async execute(input, context) {
            checkAbort(context.signal);
            const order = await services.lookupOrder(input.id, context.principal, context.signal);
            checkAbort(context.signal);
            // Always enforce object ownership even if an adapter returned a record.
            if (
              !order ||
              order.id !== input.id ||
              order.tenantId !== context.principal.tenantId ||
              order.userId !== context.principal.userId
            )
              throw new AppError('ORDER_NOT_FOUND', '订单不存在或无权访问。', 404);
            return orderResult.parse({ id: order.id, status: order.status });
          },
        }),
      );
      if (services.reviewAnswer) {
        ctx.effect(() =>
          ctx.guard.register({
            name: 'retail-review',
            validate: services.reviewAnswer!,
          }),
        );
      }
    },
  };
}

const retailDecision: HarnessPlugin = {
  name: 'retail-rule-decision',
  provide: ['decision'],
  apply(ctx) {
    const decision: DecisionService = {
      async decide(input, context) {
        checkAbort(context.signal);
        if (!context.observations.length) {
          const id = /订单\s*[:：]?\s*([A-Za-z0-9-]+)/u.exec(input.message)?.[1];
          if (id && input.availableTools.some((t) => t.name === 'order_lookup'))
            return { type: 'tool_call', tool: 'order_lookup', arguments: { id } };
          if (/配送|发货|运费/u.test(input.message))
            return {
              type: 'tool_call',
              tool: 'knowledge_search',
              arguments: { query: input.message, sources: ['retail'] },
            };
          return { type: 'ask_user', question: '请提供订单号，或说明要咨询的配送问题。' };
        }
        const last = context.observations.at(-1)!;
        if (last.tool === 'order_lookup') {
          const result = orderResult.safeParse(last.result);
          if (!result.success)
            return { type: 'ask_user', question: '无法查询该订单，请核对订单号或联系授权客服。' };
          return {
            type: 'final_answer',
            answer: `订单 ${result.data.id} 当前状态：${result.data.status}。`,
          };
        }
        const document = context.retrievedDocuments[0];
        if (!document)
          return { type: 'ask_user', question: '暂未找到相关政策，请补充信息或联系人工客服。' };
        return {
          type: 'final_answer',
          answer: document.content,
          citations: [
            {
              documentId: document.documentId,
              chunkId: document.id,
              title: document.title,
              source: document.source,
            },
          ],
        };
      },
    };
    ctx.provide('decision', decision);
  },
};

/** This preset is ordinary HarnessOptions: consumers can add more plugins. */
export function createRetailPreset(services: RetailServices): HarnessOptions {
  return {
    demoTools: false,
    providers: { decision: retailDecision, model: false },
    plugins: [createRetailExtension(services)],
  };
}

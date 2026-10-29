import { z } from 'zod';
export const opsAccessSchema = z.object({ managePlugins: z.boolean(), inspectRuns: z.boolean() });
export type OpsAccess = z.infer<typeof opsAccessSchema>;

export const runStatusSchema = z.enum(['running', 'waiting_tool', 'completed', 'failed']);
const scope = { tenantId: z.string().min(1).max(200) };
export const runListRequestSchema = z
  .object({
    ...scope,
    runId: z.string().uuid().optional(),
    conversationId: z.string().min(1).max(200).optional(),
    status: runStatusSchema.optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine(
    (v) => !v.since || !v.until || Date.parse(v.since) <= Date.parse(v.until),
    '开始时间不能晚于结束时间',
  );
export const runDetailRequestSchema = z.object({ ...scope, runId: z.string().uuid() }).strict();
export const runSummarySchema = z.object({
  runId: z.string(),
  tenantId: z.string(),
  conversationId: z.string(),
  userId: z.string(),
  question: z.string(),
  status: runStatusSchema,
  step: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const runListResponseSchema = z.object({
  runs: z.array(runSummarySchema),
  hasMore: z.boolean(),
});
export const runAccessSchema = z.object({ tenantIds: z.array(z.string()) });
export const runEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  createdAt: z.string(),
  payload: z.unknown(),
});
export const runDetailResponseSchema = z.object({
  run: runSummarySchema,
  events: z.array(runEventSchema),
});
export type RunListRequest = z.input<typeof runListRequestSchema>;
export type RunQuery = z.output<typeof runListRequestSchema>;
export type RunDetailRequest = z.infer<typeof runDetailRequestSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type RunDetail = z.infer<typeof runDetailResponseSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;

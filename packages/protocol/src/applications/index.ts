import { z } from 'zod';
import { knowledgeSpaceIdSchema } from '../knowledge/index.js';

export const applicationSchema = z.object({
  tenantId: z.string(),
  applicationId: knowledgeSpaceIdSchema,
  knowledgeSpaceId: knowledgeSpaceIdSchema,
  name: z.string(),
  active: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export const applicationKeyViewSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string(),
  label: z.string(),
  hint: z.string(),
  permissions: z.array(z.enum(['READ', 'WRITE', 'CRITICAL'])),
  allowChat: z.boolean(),
  manageKnowledge: z.boolean(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  source: z.enum(['environment', 'managed']),
});
export const createApplicationSchema = z
  .object({
    applicationId: knowledgeSpaceIdSchema,
    knowledgeSpaceId: knowledgeSpaceIdSchema,
    name: z.string().trim().min(1).max(100),
  })
  .strict();
export const updateApplicationSchema = z
  .object({
    applicationId: knowledgeSpaceIdSchema,
    version: z.number().int().nonnegative(),
    active: z.boolean(),
  })
  .strict();
export const issueApplicationKeySchema = z
  .object({
    applicationId: knowledgeSpaceIdSchema,
    label: z.string().trim().min(1).max(100),
    permissions: z
      .array(z.enum(['READ', 'WRITE', 'CRITICAL']))
      .min(1)
      .max(3)
      .default(['READ']),
    allowChat: z.boolean().default(true),
    manageKnowledge: z.boolean().default(false),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((v) => v.allowChat || v.manageKnowledge, 'At least one capability is required');
export const applicationListRequestSchema = z
  .object({ after: knowledgeSpaceIdSchema.optional() })
  .strict();
export const applicationKeyListRequestSchema = z
  .object({ applicationId: knowledgeSpaceIdSchema, after: z.string().uuid().optional() })
  .strict();
export const revokeApplicationKeySchema = z
  .object({ applicationId: knowledgeSpaceIdSchema, keyId: z.string().uuid() })
  .strict();
export const applicationListSchema = z.object({
  applications: z.array(applicationSchema),
  next: z.string().optional(),
});
export const applicationKeyListSchema = z.object({
  keys: z.array(applicationKeyViewSchema),
  next: z.string().optional(),
});
export const issuedApplicationKeySchema = z.object({
  key: applicationKeyViewSchema,
  secret: z.string().regex(/^ava_app_[A-Za-z0-9_-]{43}$/),
});
export type Application = z.infer<typeof applicationSchema>;
export type ApplicationKeyView = z.infer<typeof applicationKeyViewSchema>;
export type CreateApplication = z.infer<typeof createApplicationSchema>;
export type UpdateApplication = z.infer<typeof updateApplicationSchema>;
export type IssueApplicationKey = z.input<typeof issueApplicationKeySchema>;

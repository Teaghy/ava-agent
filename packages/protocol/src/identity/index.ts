import { z } from 'zod';

export const identityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N}_.@-]+$/u);
export const memberRoleSchema = z.enum(['tenant-admin', 'knowledge-editor', 'agent']);
export const passwordSchema = z.string().min(12).max(128);
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();
export const loginSchema = z
  .object({
    tenantId: identityIdSchema,
    userId: identityIdSchema,
    password: z.string().min(1).max(128),
  })
  .strict();
export const memberSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  role: memberRoleSchema,
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
});
export const identitySchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  role: memberRoleSchema.nullable(),
  manageMembers: z.boolean(),
  manageKnowledge: z.boolean(),
});
export const createMemberSchema = z
  .object({
    userId: identityIdSchema,
    displayName: z.string().trim().min(1).max(100),
    role: memberRoleSchema,
    password: passwordSchema,
  })
  .strict();
export const updateMemberSchema = z
  .object({
    userId: identityIdSchema,
    version: z.number().int().nonnegative(),
    role: memberRoleSchema.optional(),
    active: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.active !== undefined || v.password !== undefined);
export const memberListRequestSchema = z.object({ after: identityIdSchema.optional() }).strict();
export const memberListSchema = z.object({
  members: z.array(memberSchema),
  next: z.string().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type CreateMember = z.infer<typeof createMemberSchema>;
export type UpdateMember = z.infer<typeof updateMemberSchema>;

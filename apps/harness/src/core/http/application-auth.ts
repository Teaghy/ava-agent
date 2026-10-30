import { createHash } from 'node:crypto';
import { z } from 'zod';
import { knowledgeSpaceIdSchema } from '@ava/protocol';
import type { Principal } from '../common.types.js';
import { AppError } from '../errors.js';

const id = knowledgeSpaceIdSchema;
export const applicationKeySchema = z
  .object({
    tenantId: z.string().min(1).max(200),
    applicationId: id,
    knowledgeSpaceId: id,
    permissions: z.array(z.enum(['READ', 'WRITE', 'CRITICAL'])).default(['READ']),
    allowChat: z.boolean().default(true),
    manageKnowledge: z.boolean().default(false),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type ApplicationKey = z.infer<typeof applicationKeySchema>;
export function applicationPrincipal(key: ApplicationKey): Principal {
  if (key.expiresAt && !(Date.parse(key.expiresAt) > Date.now()))
    throw new AppError('UNAUTHORIZED', '应用凭证已失效。', 401);
  return {
    tenantId: key.tenantId,
    applicationId: key.applicationId,
    knowledgeSpaceId: key.knowledgeSpaceId,
    // Compatibility actor for tool audits; no personal account is created.
    userId: `app:${createHash('sha256')
      .update(JSON.stringify([key.tenantId, key.applicationId]))
      .digest('hex')}`,
    permissions: [...key.permissions],
    allowChat: key.allowChat,
    manageKnowledge: key.manageKnowledge,
  };
}

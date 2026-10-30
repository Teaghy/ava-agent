import { z } from 'zod';
import {
  applicationSchema,
  applicationListSchema,
  applicationKeyListSchema,
  issuedApplicationKeySchema,
  createApplicationSchema,
  updateApplicationSchema,
  issueApplicationKeySchema,
  revokeApplicationKeySchema,
  type CreateApplication,
  type UpdateApplication,
  type IssueApplicationKey,
} from '@ava/protocol';
import type { Request } from './client.js';

export function createApplicationClient(request: Request) {
  const post = async (path: string, input: unknown, signal?: AbortSignal) =>
    (
      await request(`/api/v1/applications${path}`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      })
    ).json();
  return {
    list: async (after?: string, signal?: AbortSignal) =>
      applicationListSchema.parse(await post('/list', { after }, signal)),
    create: async (input: CreateApplication) =>
      z
        .object({ application: applicationSchema })
        .parse(await post('/create', createApplicationSchema.parse(input))).application,
    update: async (input: UpdateApplication) =>
      z
        .object({ application: applicationSchema })
        .parse(await post('/update', updateApplicationSchema.parse(input))).application,
    keys: async (applicationId: string, after?: string, signal?: AbortSignal) =>
      applicationKeyListSchema.parse(await post('/keys/list', { applicationId, after }, signal)),
    issueKey: async (input: IssueApplicationKey) =>
      issuedApplicationKeySchema.parse(
        await post('/keys/issue', issueApplicationKeySchema.parse(input)),
      ),
    revokeKey: async (applicationId: string, keyId: string) =>
      z
        .object({ revoked: z.literal(true) })
        .parse(
          await post('/keys/revoke', revokeApplicationKeySchema.parse({ applicationId, keyId })),
        ),
  };
}

import { z } from 'zod';
import {
  createMemberSchema,
  changePasswordSchema,
  identitySchema,
  loginSchema,
  memberListSchema,
  memberSchema,
  updateMemberSchema,
  type CreateMember,
  type UpdateMember,
} from '@ava/protocol';
import type { Request } from './client.js';

export function createIdentityClient(request: Request) {
  return {
    changePassword: async (input: z.infer<typeof changePasswordSchema>) => {
      await request('/api/v1/auth/password', {
        method: 'POST',
        body: JSON.stringify(changePasswordSchema.parse(input)),
      });
    },
    me: async (signal?: AbortSignal) =>
      z
        .object({ identity: identitySchema })
        .parse(await (await request('/api/v1/auth/me', { signal })).json()).identity,
    login: async (input: z.infer<typeof loginSchema>, signal?: AbortSignal) =>
      z.object({ identity: identitySchema, expiresAt: z.string() }).parse(
        await (
          await request('/api/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify(loginSchema.parse(input)),
            signal,
          })
        ).json(),
      ),
    logout: async () => {
      await request('/api/v1/auth/logout', { method: 'POST' });
    },
    members: async (after?: string, signal?: AbortSignal) =>
      memberListSchema.parse(
        await (
          await request('/api/v1/members/list', {
            method: 'POST',
            body: JSON.stringify({ after }),
            signal,
          })
        ).json(),
      ),
    createMember: async (input: CreateMember) =>
      z.object({ member: memberSchema }).parse(
        await (
          await request('/api/v1/members/create', {
            method: 'POST',
            body: JSON.stringify(createMemberSchema.parse(input)),
          })
        ).json(),
      ).member,
    updateMember: async (input: UpdateMember) =>
      z.object({ member: memberSchema }).parse(
        await (
          await request('/api/v1/members/update', {
            method: 'POST',
            body: JSON.stringify(updateMemberSchema.parse(input)),
          })
        ).json(),
      ).member,
  };
}

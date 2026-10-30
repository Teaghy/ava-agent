import type { Context } from 'cordis';
import {
  applicationListRequestSchema,
  applicationKeyListRequestSchema,
  createApplicationSchema,
  updateApplicationSchema,
  issueApplicationKeySchema,
  revokeApplicationKeySchema,
} from '@ava/protocol';
import { ApplicationAccessService } from '../../core/applications/application.service.js';
import { authenticateRequest, type AuthConfig } from '../../core/http/auth.js';
import type { ApplicationKey } from '../../core/http/application-auth.js';
import type { Principal } from '../../core/common.types.js';
import { AppError } from '../../core/errors.js';

export const applicationAccessPlugin = {
  name: 'application-access',
  provide: ['applicationAccess'],
  inject: ['http', 'storage', 'telemetry'],
  async apply(
    ctx: Context,
    config: {
      auth: AuthConfig;
      environment: Record<string, ApplicationKey>;
      reservedKeys?: string[];
    },
  ) {
    const service = new ApplicationAccessService(
      ctx.storage.applicationScopes ? ctx.storage.applications : undefined,
    );
    await service.importEnvironment(config.environment);
    await service.assertSeparateKeys(config.reservedKeys ?? []);
    ctx.provide('applicationAccess', service);
    const audit = (principal: Principal, action: string, applicationId: string, keyId?: string) =>
      ctx.telemetry.log(
        {
          event: `application.${action}`,
          actor_tenant_id: principal.tenantId,
          actor_user_id: principal.userId,
          application_id: applicationId,
          key_id: keyId,
        },
        'application management',
      );
    const headers = { 'Cache-Control': 'no-store' };
    const authorize = async (request: Parameters<typeof authenticateRequest>[0]) => {
      const principal = await authenticateRequest(request, config.auth);
      if (!principal.admin || principal.applicationId)
        throw new AppError('FORBIDDEN', '此操作需要租户管理员权限。', 403);
      return principal;
    };
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/list', async (request) => {
        const principal = await authorize(request);
        const input = applicationListRequestSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_REQUEST', '应用查询参数无效。', 400);
        return { headers, body: await service.list(principal, input.data.after) };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/create', async (request) => {
        const principal = await authorize(request);
        const input = createApplicationSchema.safeParse(await request.body());
        if (!input.success)
          throw new AppError('INVALID_REQUEST', '应用名称、ID 或知识空间格式无效。', 400);
        const application = await service.create(principal, input.data);
        audit(principal, 'create', application.applicationId);
        return { status: 201, headers, body: { application } };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/update', async (request) => {
        const principal = await authorize(request);
        const input = updateApplicationSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_REQUEST', '应用变更参数无效。', 400);
        const application = await service.update(principal, input.data);
        audit(principal, 'update', application.applicationId);
        return { headers, body: { application } };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/keys/list', async (request) => {
        const principal = await authorize(request);
        const input = applicationKeyListRequestSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_REQUEST', '凭证查询参数无效。', 400);
        return {
          headers,
          body: await service.keys(principal, input.data.applicationId, input.data.after),
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/keys/issue', async (request) => {
        const principal = await authorize(request);
        const input = issueApplicationKeySchema.safeParse(await request.body());
        if (!input.success)
          throw new AppError('INVALID_REQUEST', '凭证名称、权限或有效期无效。', 400);
        const issued = await service.issue(principal, input.data);
        audit(principal, 'key.issue', input.data.applicationId, issued.key.id);
        return { status: 201, headers, body: issued };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/applications/keys/revoke', async (request) => {
        const principal = await authorize(request);
        const input = revokeApplicationKeySchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_REQUEST', '凭证参数无效。', 400);
        const result = await service.revoke(principal, input.data.applicationId, input.data.keyId);
        audit(principal, 'key.revoke', input.data.applicationId, input.data.keyId);
        return { headers, body: result };
      }),
    );
  },
};

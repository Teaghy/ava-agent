import type { Context } from 'cordis';
import { fileURLToPath } from 'node:url';
import {
  createMemberSchema,
  changePasswordSchema,
  loginSchema,
  memberListRequestSchema,
  updateMemberSchema,
} from '@ava/protocol';
import { authenticateRequest, type AuthConfig } from '../../core/http/auth.js';
import type { Principal } from '../../core/common.types.js';
import type { HttpRequest } from '../../core/http/http.types.js';
import { AppError } from '../../core/errors.js';
import {
  IdentityService,
  identityView,
  publicMember,
  sessionHash,
} from '../../core/identity/identity.service.js';
import { assertSameOrigin, cookieToken, sessionCookie } from './cookies.js';

export const localIdentityPlugin = {
  name: 'local-identity',
  inject: ['http', 'storage', 'cache', 'telemetry'],
  provide: ['identity'],
  apply(ctx: Context, config: { auth: AuthConfig; secure: boolean }) {
    if (!ctx.storage.identity)
      throw new AppError('IDENTITY_STORAGE_UNAVAILABLE', '当前存储未实现本地身份能力。');
    const identity = new IdentityService(ctx.storage.identity, ctx.cache);
    ctx.provide('identity', identity);
    const assets = import.meta.url.endsWith('.ts') ? '../../../../admin/dist/' : '../../admin/';
    ctx.effect(() => ctx.http.static('/admin/', fileURLToPath(new URL(assets, import.meta.url))));
    const authorize = async (request: HttpRequest) => {
      const principal = await authenticateRequest(request, config.auth);
      if (principal.applicationId)
        throw new AppError('FORBIDDEN', '应用凭证不能管理个人账号。', 403);
      if (!principal.admin) throw new AppError('FORBIDDEN', '此操作需要租户管理员权限。', 403);
      return principal;
    };
    const audit = (principal: Principal, action: string, userId: string) =>
      ctx.telemetry.log(
        {
          event: `identity.${action}`,
          actor_tenant_id: principal.tenantId,
          actor_user_id: principal.userId,
          target_user_id: userId,
        },
        'identity management',
      );
    ctx.effect(() =>
      ctx.http.post('/api/v1/auth/login', async (request) => {
        assertSameOrigin(request, config.secure);
        const parsed = loginSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '请输入有效的租户、账号和密码。', 400);
        const result = await identity.login(
          parsed.data.tenantId,
          parsed.data.userId,
          parsed.data.password,
        );
        audit(
          { tenantId: result.identity.tenantId, userId: result.identity.userId, permissions: [] },
          'login',
          result.identity.userId,
        );
        return {
          headers: { 'Set-Cookie': sessionCookie(result.token, config.secure, result.expiresAt) },
          body: { identity: result.identity, expiresAt: result.expiresAt },
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/auth/logout', async (request) => {
        assertSameOrigin(request, config.secure);
        try {
          await identity.store.deleteSession(sessionHash(cookieToken(request)));
        } catch (error) {
          if (!(error instanceof AppError && error.status === 401)) throw error;
        }
        return {
          headers: { 'Set-Cookie': sessionCookie('', config.secure) },
          body: { loggedOut: true },
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/auth/password', async (request) => {
        assertSameOrigin(request, config.secure);
        const token = cookieToken(request);
        const parsed = changePasswordSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '请输入当前密码及 12–128 字符的新密码。', 400);
        const principal = await identity.changePassword(
          token,
          parsed.data.currentPassword,
          parsed.data.newPassword,
        );
        audit(principal, 'password.change', principal.userId);
        return {
          headers: { 'Set-Cookie': sessionCookie('', config.secure) },
          body: { changed: true },
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.get('/api/v1/auth/me', async (request) => {
        if (request.header('authorization')) {
          const principal = await authenticateRequest(request, config.auth);
          if (principal.applicationId)
            throw new AppError('FORBIDDEN', '应用凭证不是个人登录身份。', 403);
          return { body: { identity: identityView(principal) } };
        }
        const result = await identity.resolve(cookieToken(request));
        return { body: { identity: identityView(result.principal, result.account) } };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/members/list', async (request) => {
        const principal = await authorize(request);
        const parsed = memberListRequestSchema.safeParse(await request.body());
        if (!parsed.success) throw new AppError('INVALID_REQUEST', '成员查询参数无效。', 400);
        const members = await identity.store.members(principal.tenantId, parsed.data.after, 51);
        return {
          body: {
            members: members.slice(0, 50).map(publicMember),
            ...(members.length > 50 ? { next: members[49]!.userId } : {}),
          },
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/members/create', async (request) => {
        const principal = await authorize(request);
        const parsed = createMemberSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '成员信息无效，密码需要 12–128 个字符。', 400);
        const member = await identity.create(principal, parsed.data);
        audit(principal, 'member.create', member.userId);
        return { status: 201, body: { member } };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/members/update', async (request) => {
        const principal = await authorize(request);
        const parsed = updateMemberSchema.safeParse(await request.body());
        if (!parsed.success) throw new AppError('INVALID_REQUEST', '成员变更参数无效。', 400);
        const member = await identity.update(principal, parsed.data);
        audit(principal, 'member.update', member.userId);
        return { body: { member } };
      }),
    );
  },
};

import { createHash, randomBytes } from 'node:crypto';
import { memberSchema, type Identity, type CreateMember, type UpdateMember } from '@ava/protocol';
import type { Account, IdentityStore } from './identity-store.js';
import type { CacheService } from '../cache/cache.service.js';
import type { Principal } from '../common.types.js';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword } from './password.js';

export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const publicMember = (account: Account) => memberSchema.parse(account);
export function accountPrincipal(account: Account): Principal {
  return {
    tenantId: account.tenantId,
    userId: account.userId,
    permissions: ['READ'],
    admin: account.role === 'tenant-admin',
    manageKnowledge: account.role !== 'agent',
  };
}
export function identityView(principal: Principal, account?: Account): Identity {
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    displayName: account?.displayName ?? principal.userId,
    role: account?.role ?? null,
    manageMembers: principal.admin === true,
    manageKnowledge: principal.admin === true || principal.manageKnowledge === true,
  };
}
export class IdentityService {
  constructor(
    readonly store: IdentityStore,
    private cache: CacheService,
  ) {}
  async login(tenantId: string, userId: string, password: string) {
    if (
      !(await this.cache.rateLimit('auth:login:global', 100, 60)) ||
      !(await this.cache.rateLimit(
        `auth:login:${sessionHash(JSON.stringify([tenantId, userId]))}`,
        10,
        900,
      ))
    )
      throw new AppError('RATE_LIMIT', '登录尝试过于频繁，请稍后重试。', 429);
    const account = await this.store.account(tenantId, userId);
    const valid = await verifyPassword(password, account?.passwordHash ?? '');
    if (!valid || !account?.active)
      throw new AppError('UNAUTHORIZED', '租户、账号或密码不正确，或账号已停用。', 401);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await this.store.deleteExpiredSessions(new Date().toISOString());
    await this.store.saveSession({
      hash: sessionHash(token),
      tenantId,
      userId,
      version: account.version,
      expiresAt,
    });
    return { token, expiresAt, identity: identityView(accountPrincipal(account), account) };
  }
  async resolve(token: string) {
    const session = await this.store.session(sessionHash(token));
    if (!session || !(Date.parse(session.expiresAt) > Date.now()))
      throw new AppError('UNAUTHORIZED', '登录已失效，请重新登录。', 401);
    const account = await this.store.account(session.tenantId, session.userId);
    if (!account?.active || account.version !== session.version)
      throw new AppError('UNAUTHORIZED', '登录已失效，请重新登录。', 401);
    return { principal: accountPrincipal(account), account };
  }
  async changePassword(token: string, currentPassword: string, newPassword: string) {
    const { account } = await this.resolve(token);
    if (
      !(await this.cache.rateLimit(
        `auth:password:${sessionHash(JSON.stringify([account.tenantId, account.userId]))}`,
        5,
        900,
      ))
    )
      throw new AppError('RATE_LIMIT', '密码验证过于频繁，请稍后重试。', 429);
    if (!(await verifyPassword(currentPassword, account.passwordHash)))
      throw new AppError('INVALID_PASSWORD', '当前密码不正确。', 400);
    if (
      !(await this.store.update(account.tenantId, account.userId, account.version, {
        passwordHash: await hashPassword(newPassword),
      }))
    )
      throw new AppError('MEMBER_CONFLICT', '账号已变化，请重新登录后重试。', 409);
    return accountPrincipal(account);
  }
  async create(principal: Principal, input: CreateMember) {
    if (!principal.admin) throw new AppError('FORBIDDEN', '此操作需要租户管理员权限。', 403);
    if (principal.userId === input.userId && input.role !== 'tenant-admin')
      throw new AppError('SELF_LOCKOUT', '迁移当前管理员时必须保留管理员角色。', 409);
    const account: Account = {
      tenantId: principal.tenantId,
      userId: input.userId,
      displayName: input.displayName,
      role: input.role,
      active: true,
      version: 0,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(input.password),
    };
    if (!(await this.store.create(account)))
      throw new AppError('MEMBER_EXISTS', '此租户中已存在该账号。', 409);
    return publicMember(account);
  }
  async update(principal: Principal, input: UpdateMember) {
    if (!principal.admin) throw new AppError('FORBIDDEN', '此操作需要租户管理员权限。', 403);
    const account = await this.store.account(principal.tenantId, input.userId);
    if (!account) throw new AppError('NOT_FOUND', '成员不存在。', 404);
    if (
      input.userId === principal.userId &&
      (input.active === false || (input.role !== undefined && input.role !== 'tenant-admin'))
    )
      throw new AppError('SELF_LOCKOUT', '不能停用自己或移除自己的管理员角色。', 409);
    const patch = {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.password !== undefined ? { passwordHash: await hashPassword(input.password) } : {}),
    };
    if (!(await this.store.update(principal.tenantId, input.userId, input.version, patch)))
      throw new AppError('MEMBER_CONFLICT', '成员信息已变化，请刷新后重试。', 409);
    return publicMember({ ...account, ...patch, version: input.version + 1 });
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  applicationKeyViewSchema,
  issueApplicationKeySchema,
  type Application,
  type CreateApplication,
  type UpdateApplication,
  type IssueApplicationKey,
} from '@ava/protocol';
import type { ApplicationStore, ApplicationCredential } from './application-store.js';
import { applicationPrincipal, type ApplicationKey } from '../http/application-auth.js';
import type { Principal } from '../common.types.js';
import { AppError } from '../errors.js';

export const credentialHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const publicApplicationKey = (key: ApplicationCredential) =>
  applicationKeyViewSchema.parse(key);
export class ApplicationAccessService {
  constructor(private storage?: ApplicationStore) {}
  private store() {
    if (!this.storage)
      throw new AppError('APPLICATION_STORAGE_UNSUPPORTED', '当前存储未实现应用与凭证管理。', 503);
    return this.storage;
  }
  private authorize(principal: Principal) {
    if (!principal.admin || principal.applicationId)
      throw new AppError('FORBIDDEN', '此操作需要租户管理员权限。', 403);
  }
  async importEnvironment(keys: Record<string, ApplicationKey>) {
    for (const [secret, key] of Object.entries(keys)) {
      const store = this.store();
      await store.create({
        tenantId: key.tenantId,
        applicationId: key.applicationId,
        knowledgeSpaceId: key.knowledgeSpaceId,
        name: key.applicationId,
        active: true,
        version: 0,
        createdAt: new Date().toISOString(),
      });
      const application = await store.application(key.tenantId, key.applicationId);
      if (application?.knowledgeSpaceId !== key.knowledgeSpaceId)
        throw new AppError(
          'APPLICATION_BINDING_CONFLICT',
          '环境应用与已保存的知识空间不一致，请检查应用配置。',
        );
      const hash = credentialHash(secret);
      await store.saveKey({
        id: randomUUID(),
        tenantId: key.tenantId,
        applicationId: key.applicationId,
        label: '环境配置凭证',
        hint: `••••${secret.slice(-4)}`,
        permissions: key.permissions,
        allowChat: key.allowChat,
        manageKnowledge: key.manageKnowledge,
        expiresAt: key.expiresAt ?? null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
        source: 'environment',
        hash,
      });
      const saved = await store.credential(hash);
      if (saved?.tenantId !== key.tenantId || saved.applicationId !== key.applicationId)
        throw new AppError('APPLICATION_BINDING_CONFLICT', '环境凭证与已保存的应用归属不一致。');
    }
  }
  async resolve(secret: string): Promise<Principal | undefined> {
    if (!this.storage || secret.length < 32 || secret.length > 256) return undefined;
    const key = await this.storage.credential(credentialHash(secret));
    if (!key) return undefined;
    const application = await this.storage.application(key.tenantId, key.applicationId);
    if (
      !application?.active ||
      key.revokedAt ||
      (key.expiresAt && !(Date.parse(key.expiresAt) > Date.now()))
    )
      throw new AppError('UNAUTHORIZED', '应用或凭证已失效。', 401);
    return applicationPrincipal({
      tenantId: key.tenantId,
      applicationId: key.applicationId,
      knowledgeSpaceId: application.knowledgeSpaceId,
      permissions: key.permissions,
      allowChat: key.allowChat,
      manageKnowledge: key.manageKnowledge,
      ...(key.expiresAt ? { expiresAt: key.expiresAt } : {}),
    });
  }
  async assertSeparateKeys(tokens: string[]) {
    if (!this.storage) return;
    for (const token of tokens)
      if (await this.storage.credential(credentialHash(token)))
        throw new AppError('APPLICATION_KEY_REUSED', '个人或 Ops 凭证不能复用已登记的应用 Key。');
  }
  async hasActiveKey() {
    return this.storage ? this.storage.hasActiveKey(new Date().toISOString()) : false;
  }
  async list(principal: Principal, after?: string) {
    this.authorize(principal);
    const applications = await this.store().list(principal.tenantId, after, 51);
    return {
      applications: applications.slice(0, 50),
      ...(applications.length > 50 ? { next: applications[49]!.applicationId } : {}),
    };
  }
  async create(principal: Principal, input: CreateApplication) {
    this.authorize(principal);
    const application: Application = {
      ...input,
      tenantId: principal.tenantId,
      active: true,
      version: 0,
      createdAt: new Date().toISOString(),
    };
    if (!(await this.store().create(application)))
      throw new AppError('APPLICATION_EXISTS', '此应用 ID 已存在，请使用新的 ID。', 409);
    return application;
  }
  async update(principal: Principal, input: UpdateApplication) {
    this.authorize(principal);
    const application = await this.store().application(principal.tenantId, input.applicationId);
    if (!application) throw new AppError('NOT_FOUND', '应用不存在。', 404);
    if (
      !(await this.store().update(
        principal.tenantId,
        input.applicationId,
        input.version,
        input.active,
      ))
    )
      throw new AppError('APPLICATION_CONFLICT', '应用状态已变化，请刷新后重试。', 409);
    return { ...application, active: input.active, version: input.version + 1 };
  }
  async keys(principal: Principal, applicationId: string, after?: string) {
    this.authorize(principal);
    if (!(await this.store().application(principal.tenantId, applicationId)))
      throw new AppError('NOT_FOUND', '应用不存在。', 404);
    const keys = await this.store().keys(principal.tenantId, applicationId, after, 51);
    return {
      keys: keys.slice(0, 50).map(publicApplicationKey),
      ...(keys.length > 50 ? { next: keys[49]!.id } : {}),
    };
  }
  async issue(principal: Principal, input: IssueApplicationKey) {
    this.authorize(principal);
    const parsed = issueApplicationKeySchema.parse(input);
    const application = await this.store().application(principal.tenantId, parsed.applicationId);
    if (!application) throw new AppError('NOT_FOUND', '应用不存在。', 404);
    if (!application.active)
      throw new AppError('APPLICATION_DISABLED', '请先启用应用，再签发凭证。', 409);
    if (parsed.expiresAt && !(Date.parse(parsed.expiresAt) > Date.now()))
      throw new AppError('INVALID_EXPIRY', '有效期必须晚于当前时间。', 400);
    const secret = `ava_app_${randomBytes(32).toString('base64url')}`;
    const key: ApplicationCredential = {
      id: randomUUID(),
      tenantId: principal.tenantId,
      applicationId: parsed.applicationId,
      label: parsed.label,
      hint: `••••${secret.slice(-4)}`,
      permissions: parsed.permissions,
      allowChat: parsed.allowChat,
      manageKnowledge: parsed.manageKnowledge,
      expiresAt: parsed.expiresAt ?? null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      source: 'managed',
      hash: credentialHash(secret),
    };
    if (!(await this.store().saveKey(key)))
      throw new AppError('KEY_ISSUE_FAILED', '凭证签发失败，请重试。');
    return { key: publicApplicationKey(key), secret };
  }
  async revoke(principal: Principal, applicationId: string, keyId: string) {
    this.authorize(principal);
    if (
      !(await this.store().revokeKey(
        principal.tenantId,
        applicationId,
        keyId,
        new Date().toISOString(),
      ))
    )
      throw new AppError('NOT_FOUND', '凭证不存在。', 404);
    return { revoked: true as const };
  }
}

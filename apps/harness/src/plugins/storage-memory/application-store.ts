import type { Application } from '@ava/protocol';
import type {
  ApplicationCredential,
  ApplicationStore,
} from '../../core/applications/application-store.js';

export class MemoryApplicationStore implements ApplicationStore {
  private applications = new Map<string, Application>();
  private credentials = new Map<string, ApplicationCredential>();
  snapshot() {
    return structuredClone({ applications: this.applications, credentials: this.credentials });
  }
  restore(state: ReturnType<MemoryApplicationStore['snapshot']>) {
    this.applications = structuredClone(state.applications);
    this.credentials = structuredClone(state.credentials);
  }
  private key(tenantId: string, applicationId: string) {
    return JSON.stringify([tenantId, applicationId]);
  }
  async application(tenantId: string, applicationId: string) {
    return structuredClone(this.applications.get(this.key(tenantId, applicationId)));
  }
  async list(tenantId: string, after: string | undefined, limit: number) {
    return structuredClone(
      [...this.applications.values()]
        .filter((a) => a.tenantId === tenantId && (!after || a.applicationId > after))
        .sort((a, b) =>
          a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0,
        )
        .slice(0, limit),
    );
  }
  async create(application: Application) {
    const key = this.key(application.tenantId, application.applicationId);
    if (this.applications.has(key)) return false;
    this.applications.set(key, structuredClone(application));
    return true;
  }
  async update(tenantId: string, applicationId: string, version: number, active: boolean) {
    const app = this.applications.get(this.key(tenantId, applicationId));
    if (!app || app.version !== version) return false;
    app.active = active;
    app.version++;
    return true;
  }
  async credential(hash: string) {
    return structuredClone(this.credentials.get(hash));
  }
  async keys(tenantId: string, applicationId: string, after: string | undefined, limit: number) {
    return structuredClone(
      [...this.credentials.values()]
        .filter(
          (k) =>
            k.tenantId === tenantId &&
            k.applicationId === applicationId &&
            (!after || k.id > after),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit),
    );
  }
  async saveKey(key: ApplicationCredential) {
    if (this.credentials.has(key.hash)) return false;
    if (!this.applications.has(this.key(key.tenantId, key.applicationId))) return false;
    this.credentials.set(key.hash, structuredClone(key));
    return true;
  }
  async revokeKey(tenantId: string, applicationId: string, keyId: string, now: string) {
    const key = [...this.credentials.values()].find(
      (k) => k.tenantId === tenantId && k.applicationId === applicationId && k.id === keyId,
    );
    if (!key) return false;
    key.revokedAt ??= now;
    return true;
  }
  async hasActiveKey(now: string) {
    return [...this.credentials.values()].some(
      (k) =>
        !k.revokedAt &&
        (!k.expiresAt || Date.parse(k.expiresAt) > Date.parse(now)) &&
        this.applications.get(this.key(k.tenantId, k.applicationId))?.active,
    );
  }
}

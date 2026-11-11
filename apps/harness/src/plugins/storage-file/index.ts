import type { Context } from 'cordis';
import { LocalState } from '../../core/storage/local-state.js';
import { InMemoryStorage } from '../storage-memory/index.js';

export async function createFileStorage(path: string) {
  const storage = new InMemoryStorage();
  Object.defineProperty(storage, 'persistence', { value: 'file' });
  const state = new LocalState(
    path,
    () => storage.snapshot(),
    (snapshot) => storage.restore(snapshot),
  );
  await state.load();
  const identity = storage.identity;
  const applications = storage.applications;
  Object.assign(storage, {
    identity: state.wrap(identity, [
      'create',
      'update',
      'saveSession',
      'deleteSession',
      'deleteExpiredSessions',
    ]),
    applications: state.wrap(applications, ['create', 'update', 'saveKey', 'revokeKey']),
  });
  return {
    storage: state.wrap(storage, [
      'ensureConversation',
      'deleteConversation',
      'addMessage',
      'saveSummary',
      'saveRun',
      'appendEvent',
      'audit',
      'saveKnowledge',
      'remember',
      'forget',
    ]),
    close: () => state.close(),
  };
}

export const storageFilePlugin = {
  name: 'storage-file',
  provide: ['storage'],
  async apply(ctx: Context, config: { path: string }) {
    const file = await createFileStorage(config.path);
    ctx.effect(() => () => file.close());
    ctx.provide('storage', file.storage);
  },
};

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileStorage } from '../src/plugins/storage-file/index.js';
import { createFileVector } from '../src/plugins/vector-file/index.js';
import { chunkDocument } from '../src/core/rag/chunker.js';
import { principal, makeHarness } from './helpers.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function location() {
  const root = await mkdtemp(join(tmpdir(), 'ava-local-'));
  roots.push(root);
  return join(root, 'storage.bin');
}
describe('Local durable providers', () => {
  it('restores sessions, summaries, traces, knowledge, ownership and deletion across provider restarts', async () => {
    const path = await location();
    let file = await createFileStorage(path);
    const h = await makeHarness({ SEED_KNOWLEDGE: 'false' });
    try {
      // Use a real completed state and ledger rather than a synthetic step count.
      const result = await h.ctx.agent.run({
        conversationId: 'source',
        message: 'hello',
        principal,
      });
      const state = (await h.ctx.eventStore.recover(result.runId, principal.tenantId))!;
      await file.storage.ensureConversation('source', principal);
      await Promise.all(
        (await h.ctx.sessions.recent('source')).map((message) => file.storage.addMessage(message)),
      );
      await file.storage.saveRun(state, principal.tenantId);
      for (const event of await h.ctx.eventStore.replay(result.runId, principal.tenantId))
        await file.storage.appendEvent(event);
      await file.storage.saveSummary({
        conversationId: 'source',
        summary: '保留摘要',
        confirmedFacts: [],
        executedActions: [],
        pendingItems: [],
        updatedAt: new Date().toISOString(),
      });
      const document = { id: 'guide', title: 'Guide', content: '知识保留', metadata: {} };
      await file.storage.saveKnowledge(
        document,
        principal.tenantId,
        chunkDocument(document, principal.tenantId),
      );
      await file.storage.ensureConversation('deleted', principal);
      await file.storage.deleteConversation('deleted', principal);
      const messages = await file.storage.messages('source', 100);
      const traces = await file.storage.events(result.runId, principal.tenantId);
      await file.close();
      file = await createFileStorage(path);
      expect(file.storage.persistence).toBe('file');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await file.storage.listConversations(principal, 100)).toHaveLength(1);
      expect(await file.storage.messages('source', 100)).toEqual(messages);
      expect(await file.storage.summary('source')).toMatchObject({ summary: '保留摘要' });
      expect(await file.storage.events(result.runId, principal.tenantId)).toEqual(traces);
      expect(
        await file.storage.listRuns({ tenantId: principal.tenantId, limit: 10, offset: 0 }),
      ).toMatchObject([{ runId: result.runId, step: state.step }]);
      expect(await file.storage.knowledgeChunks('guide', principal.tenantId)).toHaveLength(1);
      await expect(
        file.storage.assertConversation('source', { ...principal, userId: 'other' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(file.storage.ensureConversation('deleted', principal)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await h.stop();
      await file.close();
    }
  });
  it('persists nested identity and application mutations in the same write queue', async () => {
    const path = await location();
    const file = await createFileStorage(path);
    const now = new Date().toISOString();
    await file.storage.identity.create({
      tenantId: 'demo',
      userId: 'alice',
      displayName: 'Alice',
      role: 'agent',
      active: true,
      version: 0,
      createdAt: now,
      passwordHash: 'hash',
    });
    await file.storage.applications.create({
      tenantId: 'demo',
      applicationId: 'app',
      name: 'App',
      knowledgeSpaceId: 'space',
      active: true,
      version: 0,
      createdAt: now,
    });
    await Promise.all([
      file.storage.identity.saveSession({
        hash: 'session',
        tenantId: 'demo',
        userId: 'alice',
        version: 0,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      file.storage.identity.update('demo', 'alice', 0, { role: 'knowledge-editor' }),
      file.storage.applications.update('demo', 'app', 0, false),
    ]);
    await file.close();
    const restored = await createFileStorage(path);
    expect(await restored.storage.identity.account('demo', 'alice')).toMatchObject({
      role: 'knowledge-editor',
      version: 1,
    });
    expect(await restored.storage.identity.session('session')).toMatchObject({ userId: 'alice' });
    expect(await restored.storage.applications.application('demo', 'app')).toMatchObject({
      active: false,
      version: 1,
    });
    await restored.close();
  });
  it('rolls back a failed disk write and refuses corrupted snapshots without overwriting them', async () => {
    const path = await location();
    const file = await createFileStorage(path);
    await mkdir(path);
    await expect(file.storage.ensureConversation('unsaved', principal)).rejects.toMatchObject({
      code: 'LOCAL_STATE_WRITE_FAILED',
    });
    expect(await file.storage.listConversations(principal, 100)).toEqual([]);
    await file.close();
    await rm(path, { recursive: true });
    await writeFile(path, 'corrupt');
    await expect(createFileStorage(path)).rejects.toMatchObject({ code: 'LOCAL_STATE_INVALID' });
    expect(await readFile(path, 'utf8')).toBe('corrupt');
  });
  it('restores vectors and preserves tenant isolation after restart', async () => {
    const path = await location();
    const file = await createFileVector(path);
    const document = chunkDocument(
      { id: 'guide', title: 'Guide', content: '知识保留', metadata: {} },
      'demo',
    )[0]!;
    await file.vector.upsert([{ id: document.id, document, vector: [1, 0] }]);
    await file.close();
    const restored = await createFileVector(path);
    expect((await restored.vector.search([1, 0], 'demo', {}, 10))[0]?.id).toBe(document.id);
    expect(await restored.vector.search([1, 0], 'other', {}, 10)).toEqual([]);
    await restored.vector.delete([document.id]);
    await restored.close();
    const empty = await createFileVector(path);
    expect(await empty.vector.search([1, 0], 'demo', {}, 10)).toEqual([]);
    await empty.close();
  });
});

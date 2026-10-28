import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';
import { KnowledgeRegistry } from '../src/plugins/knowledge-registry/registry.js';
import type { RetrievedDocument } from '../src/core/rag/retrieval.types.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
const document: RetrievedDocument = {
  id: 'remote-chunk',
  documentId: 'remote-doc',
  tenantId: 'demo',
  title: 'Remote SOP',
  content: 'E102 远程资料',
  metadata: { model: 'VCD-2000' },
  score: 1,
};

describe('Pluggable knowledge sources', () => {
  it('retrieves from a registered remote source without SQL publication or changing Agent', async () => {
    const harness = await makeHarness({ SEED_KNOWLEDGE: 'false' });
    harnesses.push(harness);
    const off = harness.ctx.knowledge.register({
      name: 'remote',
      description: 'remote knowledge',
      async search() {
        return [document];
      },
    });
    expect((await harness.ctx.rag.search({ query: 'E102', tenantId: 'demo' }))[0]?.id).toBe(
      document.id,
    );
    expect(
      (await harness.ctx.rag.search({ query: 'E102', tenantId: 'demo', sources: ['remote'] }))[0]
        ?.id,
    ).toBe(document.id);
    expect(
      await harness.ctx.rag.search({
        query: 'E102',
        tenantId: 'demo',
        sources: ['remote'],
        filters: { model: 'OTHER' },
      }),
    ).toEqual([]);
    off();
    await expect(
      harness.ctx.rag.search({ query: 'E102', tenantId: 'demo', sources: ['remote'] }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_KNOWLEDGE_SOURCE' });
  });
  it('rejects duplicate names and cross-tenant results at the source boundary', async () => {
    const registry = new KnowledgeRegistry();
    const source = {
      name: 'remote',
      description: 'remote',
      async search() {
        return [document];
      },
    };
    registry.register(source);
    expect(() => registry.register(source)).toThrow('已注册');
    await expect(registry.search({ query: 'E102', tenantId: 'other' })).rejects.toMatchObject({
      code: 'KNOWLEDGE_SCOPE',
    });
  });
  it('routes historical cases to the category-scoped case source', async () => {
    const harness = await makeHarness();
    harnesses.push(harness);
    await harness.ctx.rag.ingest(
      {
        id: 'case-v1',
        title: 'E102 案例',
        content: 'E102 更换耗材后密封不完整的历史案例。',
        metadata: { category: 'case' },
      },
      'demo',
    );
    const cases = await harness.ctx.rag.search({
      query: 'E102',
      tenantId: 'demo',
      sources: ['cases'],
    });
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((doc) => doc.metadata.category === 'case')).toBe(true);
    expect(
      await harness.ctx.rag.search({ query: 'E102', tenantId: 'other', sources: ['cases'] }),
    ).toEqual([]);
  });
});

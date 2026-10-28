import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from './helpers.js';
import { demoKnowledge } from '../src/fixtures/knowledge.js';
import { chunkDocument } from '../src/core/rag/chunker.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
describe('RAG', () => {
  it('retains headings, paragraphs and ordered troubleshooting steps', () => {
    const chunks = chunkDocument(demoKnowledge, 'demo');
    expect(chunks.some((c) => c.content.includes('## 排查步骤') && c.content.includes('4.'))).toBe(
      true,
    );
    expect(chunks.every((c) => c.content.length <= 1800)).toBe(true);
    expect(chunkDocument(demoKnowledge, 'other')[0]?.id).not.toEqual(chunks[0]?.id);
  });
  it('combines keyword and vector recall, reranks and isolates tenants and filters', async () => {
    const h = await makeHarness();
    harnesses.push(h);
    const rerank = vi.spyOn(h.ctx.reranker, 'rerank');
    const docs = await h.ctx.rag.search({
      query: 'E102',
      tenantId: 'demo',
      filters: { model: 'VCD-2000' },
    });
    expect(docs.length).toBeGreaterThan(0);
    expect(rerank).toHaveBeenCalled();
    expect(await h.ctx.rag.search({ query: 'E102', tenantId: 'other' })).toEqual([]);
    expect(
      await h.ctx.rag.search({ query: 'E102', tenantId: 'demo', filters: { model: 'OTHER' } }),
    ).toEqual([]);
    await expect(
      h.ctx.rag.ingest({ ...demoKnowledge, content: '已修改的新版本' }, 'demo'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_IMMUTABLE' });
  });
  it('does not expose unpublished vectors after a failed SQL publication', async () => {
    const h = await makeHarness({ SEED_KNOWLEDGE: 'false' });
    harnesses.push(h);
    vi.spyOn(h.ctx.storage, 'saveKnowledge').mockRejectedValueOnce(new Error('db failed'));
    await expect(h.ctx.rag.ingest(demoKnowledge, 'demo')).rejects.toThrow('db failed');
    expect(await h.ctx.rag.search({ query: 'E102', tenantId: 'demo' })).toEqual([]);
  });
});

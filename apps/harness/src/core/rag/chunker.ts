import { createHash } from 'node:crypto';
import type { KnowledgeDocument, RetrievedDocument } from './retrieval.types.js';
export function stableId(value: string): string {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Markdown headings and paragraphs stay together; oversized prose splits at sentence/word boundaries. */
export function chunkDocument(
  d: KnowledgeDocument,
  tenantId: string,
  maxLength = 1800,
): RetrievedDocument[] {
  const sections = d.content.replaceAll('\r\n', '\n').split(/\n(?=#{1,6}\s)/);
  const chunks: string[] = [];
  for (const section of sections) {
    let current = '';
    const paragraphs = section.split(/\n\s*\n/);
    for (const paragraph of paragraphs) {
      const units =
        paragraph.length <= maxLength
          ? [paragraph]
          : (paragraph.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) ?? [paragraph]);
      for (const unit of units) {
        const words = unit.length <= maxLength ? [unit] : (unit.match(/\S+\s*/g) ?? [unit]);
        for (const word of words) {
          // A single unbroken block still needs a bounded fallback.
          for (let start = 0; start < word.length; start += maxLength) {
            const piece = word.slice(start, start + maxLength);
            if (current.length + piece.length + 2 > maxLength && current) {
              chunks.push(current.trim());
              current = '';
            }
            current += `${current ? '\n\n' : ''}${piece}`;
          }
        }
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks.map((content, i) => ({
    ...d,
    id: stableId(JSON.stringify([tenantId, d, i, content])),
    documentId: d.id,
    tenantId,
    content,
    score: 0,
  }));
}

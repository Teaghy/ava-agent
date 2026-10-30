export function knowledgeDocumentKey(
  tenantId: string,
  documentId: string,
  knowledgeSpaceId?: string,
) {
  return JSON.stringify(
    knowledgeSpaceId ? [tenantId, knowledgeSpaceId, documentId] : [tenantId, documentId],
  );
}
export const sameKnowledgeSpace = (
  document: { knowledgeSpaceId?: string },
  knowledgeSpaceId?: string,
) => (document.knowledgeSpaceId ?? '') === (knowledgeSpaceId ?? '');

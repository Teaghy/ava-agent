import type { Principal } from '../common.types.js';

export function sameConversationOwner(
  owner: {
    tenantId: string;
    userId: string;
    applicationId?: string | null;
    knowledgeSpaceId?: string | null;
  },
  principal: Principal,
) {
  return (
    owner.tenantId === principal.tenantId &&
    owner.userId === principal.userId &&
    (owner.applicationId ?? undefined) === principal.applicationId &&
    (owner.knowledgeSpaceId ?? undefined) === principal.knowledgeSpaceId
  );
}

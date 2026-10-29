export const applicationPresets = {
  'customer-service': {
    prompt: 'customer-service.md',
    evidence: 'knowledge-or-tool',
    knowledgeTools: true,
    demoTools: true,
  },
  knowledge: {
    prompt: 'knowledge.md',
    evidence: 'knowledge',
    knowledgeTools: true,
    demoTools: false,
  },
  chat: {
    prompt: 'chat.md',
    evidence: 'optional',
    knowledgeTools: false,
    demoTools: false,
  },
} as const;

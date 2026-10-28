import type { HarnessOptions } from '@ava/harness';
// Import your plugins from ./extensions/*.js (TypeScript source uses .js specifiers).

export default {
  // Replace a default implementation: decision, model, rag, reranker, etc.
  providers: {},
  // Add tools, knowledge sources, answer policies and other capabilities.
  plugins: [],
} satisfies HarnessOptions;

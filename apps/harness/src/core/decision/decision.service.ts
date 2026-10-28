import type { AgentDecision } from './decision.schema.js';
import type { DecisionInput, DecisionContext } from './decision.types.js';

export interface DecisionService {
  decide(input: DecisionInput, context: DecisionContext): Promise<AgentDecision>;
}

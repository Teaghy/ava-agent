import type { ModelCompatibilityOptions, ResolvedModelCompatibility } from '@ava/protocol';
export interface ModelConnection {
  baseURL: string;
  model: string;
}
export type ModelCapabilities = Pick<
  ResolvedModelCompatibility,
  'messageFormat' | 'jsonOutput' | 'streamUsage'
>;
export interface ModelCompatibilityRule {
  id: string;
  label: string;
  connection: ModelConnection;
  capabilities: Partial<ModelCapabilities>;
}
export interface ModelCompatibilityService {
  resolve(
    connection: ModelConnection,
    options?: ModelCompatibilityOptions,
  ): ResolvedModelCompatibility;
  register(rule: ModelCompatibilityRule): () => void;
}

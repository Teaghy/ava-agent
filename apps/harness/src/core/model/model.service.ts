import type { ModelDelta, ModelRequest, ModelResponse } from './model.types.js';
import type { z } from 'zod';
export interface ModelService {
  chat(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelDelta>;
  structuredOutput<T>(schema: z.ZodType<T>, request: ModelRequest): Promise<T>;
}

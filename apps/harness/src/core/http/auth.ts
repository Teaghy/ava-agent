import type { HttpRequest } from './http.types.js';
import type { Principal } from '../common.types.js';
import { AppError } from '../errors.js';
export interface AuthConfig {
  keys: Record<string, Principal>;
}
export function authenticate(request: HttpRequest, config: AuthConfig): Principal {
  const authorization = request.header('authorization');
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const principal = token && Object.hasOwn(config.keys, token) ? config.keys[token] : undefined;
  if (!principal) throw new AppError('UNAUTHORIZED', '请提供有效的 API Token。', 401);
  return structuredClone(principal);
}

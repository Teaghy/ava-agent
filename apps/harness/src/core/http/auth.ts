import type { HttpRequest } from './http.types.js';
import type { Principal } from '../common.types.js';
import { AppError } from '../errors.js';
import { applicationPrincipal, type ApplicationKey } from './application-auth.js';
export interface AuthConfig {
  keys: Record<string, Principal>;
  applicationKeys?: Record<string, ApplicationKey>;
  resolveApplication?: (token: string) => Promise<Principal | undefined>;
  session?: (request: HttpRequest) => Promise<Principal>;
  validatePrincipal?: (principal: Principal) => Promise<Principal>;
}
export async function authenticateRequest(
  request: HttpRequest,
  config: AuthConfig,
): Promise<Principal> {
  if (request.header('authorization') || !config.session) {
    const token = request.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const principal =
      (token && config.resolveApplication ? await config.resolveApplication(token) : undefined) ??
      authenticate(request, config);
    return config.validatePrincipal ? config.validatePrincipal(principal) : principal;
  }
  return config.session(request);
}
export function authenticate(request: HttpRequest, config: AuthConfig): Principal {
  const authorization = request.header('authorization');
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (token && config.applicationKeys && Object.hasOwn(config.applicationKeys, token))
    return applicationPrincipal(config.applicationKeys[token]!);
  const principal = token && Object.hasOwn(config.keys, token) ? config.keys[token] : undefined;
  if (!principal) throw new AppError('UNAUTHORIZED', '请提供有效的 API Token。', 401);
  return structuredClone(principal);
}

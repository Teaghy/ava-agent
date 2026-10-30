import type { HttpRequest } from '../../core/http/http.types.js';
import { AppError } from '../../core/errors.js';

const cookieName = 'ava_session';
export function sessionCookie(token: string, secure: boolean, expires?: string) {
  return `${cookieName}=${token}; Path=/api/v1; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${token ? 28800 : 0}${expires ? `; Expires=${new Date(expires).toUTCString()}` : ''}`;
}
export function cookieToken(request: HttpRequest) {
  const values = (request.header('cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${cookieName}=`));
  const token = values.length === 1 ? values[0]!.slice(cookieName.length + 1) : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('UNAUTHORIZED', '请先登录。', 401);
  return token;
}
export function assertSameOrigin(request: HttpRequest, secure = false) {
  const origin = request.header('origin');
  try {
    const url = new URL(origin ?? '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (secure && url.protocol !== 'https:') ||
      url.host !== request.header('host') ||
      request.header('sec-fetch-site') === 'cross-site'
    )
      throw new Error();
  } catch {
    throw new AppError('FORBIDDEN_ORIGIN', '请从当前站点发起操作。', 403);
  }
}

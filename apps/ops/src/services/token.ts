const key = 'ava.ops.token';
export function readToken(): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
export function saveToken(token: string): boolean {
  try {
    if (token) sessionStorage.setItem(key, token);
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

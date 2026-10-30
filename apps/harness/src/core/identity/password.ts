import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

let hashing = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (hashing >= 4) throw new AppError('AUTH_BUSY', '登录服务繁忙，请稍后重试。', 429);
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    hashing--;
  }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-32768-8-3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^scrypt-32768-8-3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  // Unknown accounts still perform the same password work.
  const actual = await derive(password, match?.[1] ?? '00000000000000000000000000000000');
  return timingSafeEqual(actual, Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex')) && !!match;
}

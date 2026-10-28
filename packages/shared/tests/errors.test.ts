import { describe, expect, it } from 'vitest';
import { AppError, publicError, safeSource } from '../src/index.js';
describe('Shared safe utilities', () => {
  it('masks provider internals and preserves intentional public errors', () => {
    expect(publicError(new Error('secret'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: '请求处理失败，请稍后重试。',
    });
    expect(publicError(new AppError('FORBIDDEN', '拒绝访问', 403))).toEqual({
      code: 'FORBIDDEN',
      message: '拒绝访问',
    });
  });
  it('permits only http(s) citation links', () => {
    expect(safeSource('javascript:alert(1)')).toBeUndefined();
    expect(safeSource('https://example.com/manual')).toBe('https://example.com/manual');
  });
});

import { describe, expect, it } from 'vitest';
import { parseLocalDateTime, formatLocalDateTime } from '../src/date-time';
describe('local date-time values', () => {
  it('preserves local calendar fields rather than converting them to UTC', () => {
    const date = new Date(2026, 9, 30, 8, 5);
    expect(formatLocalDateTime(date)).toBe('2026-10-30T08:05');
    expect(parseLocalDateTime('2026-10-30T08:05')?.getHours()).toBe(8);
    expect(parseLocalDateTime(formatLocalDateTime(date))?.getTime()).toBe(date.getTime());
  });
  it('rejects empty, malformed and overflowing calendar values', () => {
    for (const value of [
      '',
      '2026-02-30T12:00',
      '2026-13-01T12:00',
      '2026-01-01T25:00',
      '2026-01-01T12:60',
      '2026-10-30T08:05Z',
    ])
      expect(parseLocalDateTime(value)).toBeUndefined();
  });
});

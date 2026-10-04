import { describe, expect, it } from 'vitest';
import { formatTaipeiDateTime } from './taipeiTime';

describe('formatTaipeiDateTime', () => {
  it('converts UTC to Asia/Taipei and drops seconds', () => {
    expect(formatTaipeiDateTime('2026-10-03T02:11:59.999Z')).toBe('2026-10-03 10:11');
  });
  it('rolls the date forward across midnight', () => {
    expect(formatTaipeiDateTime('2026-10-02T16:30:00.000Z')).toBe('2026-10-03 00:30');
  });
  it('returns unparseable input unchanged rather than inventing a time', () => {
    expect(formatTaipeiDateTime('not-a-date')).toBe('not-a-date');
    expect(formatTaipeiDateTime('')).toBe('');
  });
});

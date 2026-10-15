import { describe, it, expect } from 'vitest';
import { toYMD, parseLocalDate } from './formatting';

describe('QA-006: toYMD helper produces correct YYYY-MM-DD in any timezone', () => {
  it('produces 2026-01-01 for new Date(2026, 0, 1)', () => {
    expect(toYMD(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('produces 2026-12-01 for new Date(2026, 11, 1)', () => {
    expect(toYMD(new Date(2026, 11, 1))).toBe('2026-12-01');
  });

  it('produces 2026-03-15 for new Date(2026, 2, 15)', () => {
    expect(toYMD(new Date(2026, 2, 15))).toBe('2026-03-15');
  });

  it('round-trips with parseLocalDate', () => {
    const d = new Date(2026, 5, 15);
    const ymd = toYMD(d);
    const parsed = parseLocalDate(ymd);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(15);
  });

  it('never produces the previous day (the toISOString bug)', () => {
    // In Asia/Yerevan (UTC+4), new Date(2026, 0, 1).toISOString()
    // returns '2025-12-31T20:00:00.000Z' → split('T')[0] = '2025-12-31'
    // toYMD must return '2026-01-01' regardless of timezone.
    const d = new Date(2026, 0, 1);
    const result = toYMD(d);
    expect(result).toBe('2026-01-01');
    expect(result).not.toBe('2025-12-31');
  });

  it('handles month boundaries correctly', () => {
    expect(toYMD(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(toYMD(new Date(2026, 1, 1))).toBe('2026-02-01');
  });
});

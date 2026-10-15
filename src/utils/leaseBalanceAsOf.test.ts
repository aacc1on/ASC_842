import { describe, it, expect } from 'vitest';
import { addMonthsYMD, monthEndOf } from './leaseBalanceAsOf';

describe('date helpers', () => {
  it('monthEndOf handles leap years', () => {
    expect(monthEndOf('2028-02-01')).toBe('2028-02-29');
  });
  it('addMonthsYMD clamps the day', () => {
    expect(addMonthsYMD('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYMD('2026-10-11', 12)).toBe('2027-10-11');
  });
});

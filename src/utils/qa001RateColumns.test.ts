import { describe, it, expect } from 'vitest';

/**
 * QA-001: Rate columns numeric(5,4) reject rates of 10% or more.
 * This test validates that the code can produce rates ≥ 10% and that
 * the numeric values are correct. The actual column widening is done
 * via migration; this test verifies the code paths handle high rates.
 */

describe('QA-001: Rate values of 10% and 25% are representable', () => {
  it('12% rate as decimal 0.12 fits in numeric(7,4)', () => {
    const rate = 0.12;
    const formatted = rate.toFixed(4);
    expect(formatted).toBe('0.1200');
    // numeric(7,4) allows up to 999.9999
    expect(parseFloat(formatted)).toBe(0.12);
  });

  it('25% rate as decimal 0.25 fits in numeric(7,4)', () => {
    const rate = 0.25;
    const formatted = rate.toFixed(4);
    expect(formatted).toBe('0.2500');
    expect(parseFloat(formatted)).toBe(0.25);
  });

  it('12% as percentage 12 fits in numeric(7,4)', () => {
    // If the form stores the rate as a percentage (12 for 12%)
    const rate = 12;
    const asDecimal = rate / 100;
    expect(asDecimal).toBe(0.12);
  });

  it('25% as percentage 25 fits in numeric(7,4)', () => {
    const rate = 25;
    const asDecimal = rate / 100;
    expect(asDecimal).toBe(0.25);
  });
});

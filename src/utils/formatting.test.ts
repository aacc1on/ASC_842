import { describe, expect, it } from 'vitest';
import { formatBillingDate, formatDate, parseLocalDate } from './formatting';
import { calculateNoncancellableTermMonths } from '../components/lease-form/leaseFormCalculations';
import type { LeaseFormData } from '../components/lease-form/types';

describe('date-only formatting', () => {
  it('keeps YYYY-MM-DD dates on their calendar day', () => {
    expect(formatDate('2020-01-01')).toBe('Jan 1, 2020');
    expect(formatDate('2040-01-01')).toBe('Jan 1, 2040');
  });

  it('parses date-only values as local calendar dates', () => {
    const date = parseLocalDate('2020-01-01');
    expect(date.getFullYear()).toBe(2020);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(1);
  });

  it('calculates the inclusive month term from local date values', () => {
    const formData = {
      lease_term_months: '',
      lease_start_date: '2020-01-01',
      lease_end_date: '2040-01-01',
    } as LeaseFormData;
    expect(calculateNoncancellableTermMonths(formData)).toBe(241);
  });
});

describe('formatBillingDate', () => {
  it('returns a dash for empty input', () => {
    expect(formatBillingDate(null)).toBe('—');
  });

  it('treats numbers as unix seconds', () => {
    expect(formatBillingDate(Date.UTC(2026, 8, 15, 12) / 1000)).toBe('September 15, 2026');
  });
});

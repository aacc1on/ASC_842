import { describe, it, expect } from 'vitest';
import { formatCurrency, formatCurrencyCompact, formatDate, formatPeriodLabel, parseLocalDate } from './formatting';
import { getErrorMessage, getErrorCode } from './errors';
import { normalizeEntryType } from './entryTypes';

describe('formatting utils', () => {
  it('formatCurrency formats with 2 decimals by default', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formatCurrency supports custom decimals', () => {
    expect(formatCurrency(1234.5, 0)).toBe('$1,235');
  });

  it('formatCurrencyCompact formats without decimals', () => {
    expect(formatCurrencyCompact(1234.5)).toBe('$1,235');
  });

  it('formatDate formats a date string', () => {
    expect(formatDate('2026-03-15')).toMatch(/Mar.*2026/);
  });

  it('formatPeriodLabel formats YYYY-MM as Month Year', () => {
    expect(formatPeriodLabel('2026-03')).toBe('March 2026');
  });

  it('parseLocalDate parses a date string into a local Date', () => {
    const d = parseLocalDate('2026-03-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it('parseLocalDate handles ISO datetime strings', () => {
    const d = parseLocalDate('2026-03-15T10:30:00Z');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });
});

describe('errors utils', () => {
  it('getErrorMessage passes through an intentional application message', () => {
    expect(getErrorMessage(new Error('Amount must be greater than zero'))).toBe(
      'Amount must be greater than zero',
    );
  });

  it('getErrorMessage hides internal database detail', () => {
    expect(
      getErrorMessage({
        code: '42501',
        message: 'new row violates row-level security policy for table "leases"',
      }),
    ).not.toContain('row-level security');
    expect(
      getErrorMessage(new Error('duplicate key value violates unique constraint "leases_pkey"')),
    ).not.toContain('constraint');
  });

  it('getErrorMessage uses the supplied fallback for unsafe messages', () => {
    expect(getErrorMessage(new Error('relation "x" does not exist'), 'Failed to load leases')).toBe(
      'Failed to load leases',
    );
  });

  it('getErrorMessage returns a generic message for unknown types', () => {
    expect(getErrorMessage(42)).toContain('Something went wrong');
    expect(getErrorMessage(null)).toContain('Something went wrong');
  });

  it('getErrorCode extracts code from object', () => {
    expect(getErrorCode({ code: 'PGRST116' })).toBe('PGRST116');
  });

  it('getErrorCode returns undefined when no code', () => {
    expect(getErrorCode(new Error('no code'))).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});

describe('entryTypes utils', () => {
  it('normalizes known aliases', () => {
    expect(normalizeEntryType('initial_recognition')).toBe('Initial Recognition');
    expect(normalizeEntryType('payment')).toBe('Lease Payment');
    expect(normalizeEntryType('lease_payment')).toBe('Lease Payment');
    expect(normalizeEntryType('interest')).toBe('Interest Accrual');
    expect(normalizeEntryType('interest_accrual')).toBe('Interest Accrual');
    expect(normalizeEntryType('amortization')).toBe('Depreciation');
    expect(normalizeEntryType('depreciation')).toBe('Depreciation');
    expect(normalizeEntryType('operating_lease_expense')).toBe('Operating Lease Expense');
    expect(normalizeEntryType('modification')).toBe('Modification');
    expect(normalizeEntryType('remeasurement')).toBe('Remeasurement');
    expect(normalizeEntryType('termination')).toBe('Termination');
    expect(normalizeEntryType('lease_cancellation')).toBe('Lease Cancellation');
    expect(normalizeEntryType('derecognition')).toBe('Derecognition');
    expect(normalizeEntryType('prepayment')).toBe('Prepayment');
  });

  it('title-cases unknown types', () => {
    expect(normalizeEntryType('some_custom_type')).toBe('Some Custom Type');
  });

  it('handles empty string', () => {
    expect(normalizeEntryType('')).toBe('');
  });

  it('is case-insensitive', () => {
    expect(normalizeEntryType('PAYMENT')).toBe('Lease Payment');
    expect(normalizeEntryType('Interest')).toBe('Interest Accrual');
  });
});

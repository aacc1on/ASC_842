import { describe, it, expect } from 'vitest';
import {
  validateMonthEndPeriod,
  periodHasEnded,
  latestPostedBlocker,
  getPreviousPeriod,
  getNextPeriod,
  summarizeMonthEndTransactions,
} from './monthEndPeriods';
import type { MonthEndTransaction } from './monthEndTypes';

const txn = (lease_id: string, transaction_type: string, amount: number): MonthEndTransaction => ({
  lease_id,
  lease_name: lease_id,
  transaction_date: '2026-09-30',
  transaction_type,
  account_debited: 'D',
  account_credited: 'C',
  debit_amount: amount,
  credit_amount: amount,
  description: '',
  reference_number: '',
  period: '2026-09',
});

describe('monthEndPeriods', () => {
  it('validates period format, month and year range', () => {
    expect(validateMonthEndPeriod('2026-09')).toEqual({ valid: true });
    expect(validateMonthEndPeriod('2026-9').valid).toBe(false);
    expect(validateMonthEndPeriod('2026-13').error).toBe('Month must be between 01 and 12');
    expect(validateMonthEndPeriod('1999-01').error).toBe('Year must be between 2000 and 2100');
  });

  it('treats a month as ended only after its last day', () => {
    expect(periodHasEnded('2026-09', new Date(2026, 8, 30))).toBe(false);
    expect(periodHasEnded('2026-09', new Date(2026, 9, 1))).toBe(true);
  });

  it('blocks removing a posted month that is not the latest posted month', () => {
    const docs = [
      { period: '2026-08', status: 'posted' },
      { period: '2026-09', status: 'finalized' },
      { period: '2026-10', status: 'draft' },
    ];
    expect(latestPostedBlocker(docs, docs[0])).toMatch(/^Remove later months first/);
    expect(latestPostedBlocker(docs, docs[1])).toBeNull();
    expect(latestPostedBlocker(docs, docs[2])).toBeNull();
  });

  it('steps across year boundaries', () => {
    expect(getPreviousPeriod('2026-01')).toBe('2025-12');
    expect(getNextPeriod('2026-12')).toBe('2027-01');
  });

  it('summarizes totals by transaction type', () => {
    const summary = summarizeMonthEndTransactions([
      txn('a', 'interest', 10),
      txn('a', 'payment', 100),
      txn('b', 'amortization', 50),
      txn('b', 'operating_lease_expense', 30),
      txn('c', 'short_term_lease_expense', 5),
    ]);
    expect(summary).toEqual({
      totalLeases: 3,
      totalTransactions: 5,
      totalDebits: 195,
      totalCredits: 195,
      totalInterest: 10,
      totalPayments: 100,
      totalDepreciation: 50,
      totalOperatingLeaseCost: 30,
      totalShortTermLeaseCost: 5,
    });
  });
});

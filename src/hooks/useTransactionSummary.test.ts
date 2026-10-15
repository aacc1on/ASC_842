import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Transaction } from '../components/transactions/types';
import { useTransactionSummary } from './useTransactionSummary';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', lease_id: 'L1', transaction_date: '2026-01-15', transaction_type: 'payment',
  account_debited: 'Lease Liability', account_credited: 'Cash', debit_amount: 0, credit_amount: 0,
  description: '', reference_number: '', period: '2026-01', is_reversed: false, created_at: '', ...over,
});

describe('useTransactionSummary', () => {
  it('returns zeros and empty collections for no transactions', () => {
    const { result } = renderHook(() => useTransactionSummary([]));
    expect(result.current).toEqual({
      totalDebits: 0, totalCredits: 0, debitAccountSummary: [], creditAccountSummary: [], activeBranches: [],
      debitByAccountAndBranch: {}, creditByAccountAndBranch: {},
    });
  });

  it('groups by account and branch, ordering summaries by total and branches by code', () => {
    const rows = [
      tx({ debit_amount: 10, credit_amount: 10, branch_id: 'br-2', branch_name: 'South', branch_code: 'S01' }),
      tx({ debit_amount: 30, credit_amount: 30, account_debited: 'Interest Expense', branch_id: 'br-1', branch_name: 'North', branch_code: 'N01' }),
      tx({ debit_amount: 5, credit_amount: 5, branch_id: null }),
      tx({ debit_amount: 7, credit_amount: 0, account_credited: '', branch_id: 'br-3', branch_name: 'East', branch_code: null }),
      tx({ debit_amount: 0, credit_amount: 4, account_credited: 'Accrued', branch_id: 'br-4', branch_name: 'West', branch_code: null }),
      tx({ debit_amount: 2, credit_amount: 2, account_debited: '', account_credited: '' }),
    ];
    const { result } = renderHook(() => useTransactionSummary(rows));
    const r = result.current;
    expect(r.totalDebits).toBe(54);
    expect(r.totalCredits).toBe(51);
    expect(r.debitAccountSummary).toEqual([
      { account: 'Interest Expense', total: 30, count: 1 },
      { account: 'Lease Liability', total: 22, count: 3 },
    ]);
    expect(r.creditAccountSummary).toEqual([
      { account: 'Cash', total: 45, count: 3 },
      { account: 'Accrued', total: 4, count: 1 },
    ]);
    expect(r.activeBranches.map((b) => b.label)).toEqual(['North (N01)', 'South (S01)', 'East', 'No branch', 'West']);
    expect(r.activeBranches.find((b) => b.id === 'unassigned')).toMatchObject({ branch_name: '', branch_code: null });
    expect(r.debitByAccountAndBranch['Lease Liability']).toEqual({ 'br-2': 10, unassigned: 5, 'br-3': 7 });
    expect(r.creditByAccountAndBranch.Cash).toEqual({ 'br-2': 10, 'br-1': 30, unassigned: 5 });
    expect(r.creditByAccountAndBranch.Accrued).toEqual({ 'br-4': 4 });
  });

  it('memoises on the input array', () => {
    const rows = [tx({ debit_amount: 1, credit_amount: 1 })];
    const { result, rerender } = renderHook(({ r }) => useTransactionSummary(r), { initialProps: { r: rows } });
    const first = result.current;
    rerender({ r: rows });
    expect(result.current).toBe(first);
    rerender({ r: [...rows] });
    expect(result.current).not.toBe(first);
  });
});

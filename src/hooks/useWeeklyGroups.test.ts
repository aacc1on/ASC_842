import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWeeklyGroups } from './useWeeklyGroups';
import type { Transaction } from '../components/transactions/types';

let seq = 0;
function tx(date: string, debit: number | null, credit: number | null, extra: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    lease_id: 'L1',
    transaction_date: date,
    transaction_type: 'payment',
    account_debited: 'Lease Liability',
    account_credited: 'Cash',
    debit_amount: debit as number,
    credit_amount: credit as number,
    description: '',
    reference_number: '',
    period: date.slice(0, 7),
    is_reversed: false,
    created_at: date,
    ...extra,
  };
}

describe('useWeeklyGroups', () => {
  it('returns no groups for an empty list', () => {
    const { result } = renderHook(() => useWeeklyGroups([]));
    expect(result.current.weeklyGroups).toEqual([]);
    expect(result.current.expandedWeeks).toEqual({});
    expect(result.current.expandedSections).toEqual({});
  });

  it('groups transactions into Monday-start weeks, totals amounts and sorts newest week first', () => {
    const txs = [
      tx('2026-10-05', 100, 0), // Monday -> week of 10-05
      tx('2026-10-13', 50, 25), // Tuesday -> week of 10-12
      tx('2026-10-11', 10, 10), // Sunday -> still week of 10-05
      tx('2026-10-18', 5, 7), // Sunday -> week of 10-12
      tx('2026-09-30', 1, 2), // Wednesday -> week of 09-28
    ];
    const { result } = renderHook(() => useWeeklyGroups(txs));
    const groups = result.current.weeklyGroups;

    expect(groups.map((g) => g.weekKey)).toEqual(['2026-10-12', '2026-10-05', '2026-09-28']);
    expect(groups[0].weekLabel).toBe('Oct 12 – Oct 18, 2026');
    expect(groups[0].transactions.map((t) => t.transaction_date)).toEqual(['2026-10-13', '2026-10-18']);
    expect(groups[0].totalDebits).toBe(55);
    expect(groups[0].totalCredits).toBe(32);
    expect(groups[1].totalDebits).toBe(110);
    expect(groups[1].totalCredits).toBe(10);
    expect(groups[1].endDate.getDate()).toBe(11);
    expect(groups[2].weekLabel).toBe('Sep 28 – Oct 4, 2026');
  });

  it('handles weeks spanning a year boundary', () => {
    const { result } = renderHook(() => useWeeklyGroups([tx('2027-01-01', 10, 10)]));
    expect(result.current.weeklyGroups[0].weekKey).toBe('2026-12-28');
    expect(result.current.weeklyGroups[0].weekLabel).toBe('Dec 28 – Jan 3, 2027');
  });

  it('skips unparseable dates and treats null amounts as zero', () => {
    const txs = [tx('not-a-date', 999, 999), tx('2026-10-13', null, null), tx('2026-10-14', 3, null)];
    const { result } = renderHook(() => useWeeklyGroups(txs));
    expect(result.current.weeklyGroups).toHaveLength(1);
    expect(result.current.weeklyGroups[0].transactions).toHaveLength(2);
    expect(result.current.weeklyGroups[0].totalDebits).toBe(3);
    expect(result.current.weeklyGroups[0].totalCredits).toBe(0);
  });

  it('recomputes when the transaction list changes and memoises otherwise', () => {
    const a = [tx('2026-10-13', 1, 1)];
    const { result, rerender } = renderHook(({ list }) => useWeeklyGroups(list), { initialProps: { list: a } });
    const first = result.current.weeklyGroups;
    rerender({ list: a });
    expect(result.current.weeklyGroups).toBe(first);
    rerender({ list: [...a, tx('2026-10-20', 2, 2)] });
    expect(result.current.weeklyGroups).toHaveLength(2);
  });

  it('toggles week and section expansion independently', () => {
    const { result } = renderHook(() => useWeeklyGroups([tx('2026-10-13', 1, 1)]));
    act(() => result.current.toggleWeek('2026-10-12'));
    expect(result.current.expandedWeeks).toEqual({ '2026-10-12': true });
    act(() => result.current.toggleSection('2026-10-12-debits'));
    act(() => result.current.toggleSection('2026-10-12-credits'));
    expect(result.current.expandedSections).toEqual({ '2026-10-12-debits': true, '2026-10-12-credits': true });
    act(() => result.current.toggleWeek('2026-10-12'));
    act(() => result.current.toggleSection('2026-10-12-debits'));
    expect(result.current.expandedWeeks).toEqual({ '2026-10-12': false });
    expect(result.current.expandedSections['2026-10-12-debits']).toBe(false);
  });
});

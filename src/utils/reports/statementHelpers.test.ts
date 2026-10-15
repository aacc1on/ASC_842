import { describe, it, expect } from 'vitest';
import type { Lease } from '../../types/lease';
import { accountMatches, localDateStr, processTerminationModForCashFlow, processTerminationModForPL, pushBreakdown } from './statementHelpers';
import type { LeaseBreakdownItem } from './statementTypes';

const lease = { id: 'l1', lease_name: 'Office', lease_classification: 'finance' } as Lease;
const leaseMap = new Map([[lease.id, lease]]);
const row = (debited: string, credited: string, amount: number, date = '2026-03-31') => ({
  lease_id: 'l1', transaction_date: date, account_debited: debited, account_credited: credited, amount, transaction_type: 'termination',
});

describe('statementHelpers', () => {
  it('formats local dates and matches account names case-insensitively', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(accountMatches('  lease liability ', ['Lease Liability'])).toBe(true);
    expect(accountMatches('', ['Cash'])).toBe(false);
  });

  it('pushBreakdown merges per lease, keeps the latest date and ignores non-positive values', () => {
    const arr: LeaseBreakdownItem[] = [];
    pushBreakdown(arr, leaseMap, 'l1', 100, '2026-01-31');
    pushBreakdown(arr, leaseMap, 'l1', 50, '2026-02-28');
    pushBreakdown(arr, leaseMap, 'l1', 0, '2026-03-31');
    pushBreakdown(arr, leaseMap, 'unknown', 10, '2026-03-31');
    expect(arr).toEqual([{ leaseId: 'l1', leaseName: 'Office', classification: 'finance', value: 150, transactionDate: '2026-02-28' }]);
  });

  it('processTerminationModForPL splits gains and losses', () => {
    const gain = { v: 0 };
    const loss = { v: 0 };
    const bk: LeaseBreakdownItem[] = [];
    processTerminationModForPL([
      row('Lease Liability', 'Gain on Lease Termination', 400),
      row('Impairment Loss', 'Right-of-Use Asset', 250),
      row('Lease Liability', 'Right-of-Use Asset', 9999),
    ], leaseMap, gain, loss, bk);
    expect(gain.v).toBe(400);
    expect(loss.v).toBe(250);
    expect(bk.map((b) => b.value)).toEqual([400, -250]);
  });

  it('processTerminationModForCashFlow totals cash credits per lease', () => {
    const cash = { v: 0 };
    const bk: LeaseBreakdownItem[] = [];
    processTerminationModForCashFlow([row('Loss', 'Cash', 300), row('Loss', 'cash', 200), row('Loss', 'Liability', 50)], leaseMap, cash, bk);
    expect(cash.v).toBe(500);
    expect(bk).toHaveLength(1);
    expect(bk[0].value).toBe(500);
  });
});

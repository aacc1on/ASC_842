import { describe, it, expect } from 'vitest';
import type { Lease } from '../types/lease';
import {
  buildDashboardRow,
  filterDashboardRows,
  groupDashboardRows,
  sortDashboardRows,
  totalDashboardRows,
  DEFAULT_DASHBOARD_FILTERS,
} from './leaseDashboard';
import { buildPaymentStream } from './leaseCalculations';

const AS_OF = '2026-03-15';

function lease(over: Partial<Lease>): Lease {
  return {
    id: 'L', lease_name: 'Lease', lease_start_date: '2025-01-01', lease_end_date: '2027-12-31', lease_term_months: 36,
    payment_amount: 1000, payment_frequency: 'monthly', payment_timing: 'beginning', lease_classification: 'operating',
    status: 'active', component_policy: 'not_applicable', branch_id: 'b1', ...over,
  } as Lease;
}

describe('buildDashboardRow', () => {
  it('uses the stored payment and escalation schedule for the lease total', () => {
    const tranches = [{ fromMonth: 1, toMonth: 12, paymentAmount: 1000 }, { fromMonth: 13, toMonth: 36, paymentAmount: 1100 }];
    const r = buildDashboardRow(lease({}), tranches, 'Main', AS_OF);
    const expected = buildPaymentStream(36, 1000, tranches, 'monthly', 'beginning').reduce((s, p) => s + p, 0);
    expect(r.totalLease).toBe(expected);
    expect(r.totalLease).toBe(12 * 1000 + 24 * 1100);
    expect(r.monthlyLease).toBe(1100);
    expect(r.monthsRemaining).toBe(22);
    expect(r.monthlyNonlease).toBeNull();
    expect(r.totalNonlease).toBeNull();
  });

  it('strips the non-lease part out of a combined measurement payment', () => {
    const r = buildDashboardRow(
      lease({ payment_amount: 1200, lease_component_amount: 1000, nonlease_component_amount: 200, component_policy: 'combined', lease_term_months: 12, lease_start_date: '2026-01-01', lease_end_date: '2026-12-31' }),
      [{ fromMonth: 1, toMonth: 6, paymentAmount: 1200 }, { fromMonth: 7, toMonth: 12, paymentAmount: 1300 }],
      '', AS_OF,
    );
    expect(r.totalLease).toBe(6 * 1000 + 6 * 1100);
    expect(r.monthlyNonlease).toBe(200);
    expect(r.totalNonlease).toBe(2400);
  });

  it('books separate non-lease monthly over the term and spreads quarterly lease payments per month', () => {
    const r = buildDashboardRow(
      lease({ payment_amount: 3000, payment_frequency: 'quarterly', nonlease_component_amount: 50, component_policy: 'separate', lease_term_months: 12, lease_start_date: '2026-01-01', lease_end_date: '2026-12-31' }),
      [], '', AS_OF,
    );
    expect(r.totalLease).toBe(12000);
    expect(r.monthlyLease).toBe(1000);
    expect(r.totalNonlease).toBe(600);
  });

  it('reports full term remaining before start and zero after the end', () => {
    expect(buildDashboardRow(lease({ lease_start_date: '2026-06-01', lease_end_date: '2029-05-31' }), [], '', AS_OF).monthsRemaining).toBe(36);
    const ended = buildDashboardRow(lease({ lease_start_date: '2022-01-01', lease_end_date: '2024-12-31' }), [], '', AS_OF);
    expect(ended.monthsRemaining).toBe(0);
    expect(ended.expired).toBe(true);
  });
});

describe('grouping, totals, filters and sorting', () => {
  const rows = [
    buildDashboardRow(lease({ id: 'f1', lease_name: 'Forklift', lease_classification: 'finance', payment_amount: 500, lease_term_months: 24, nonlease_component_amount: 25, component_policy: 'separate' }), [], 'Main', AS_OF),
    buildDashboardRow(lease({ id: 'o1', lease_name: 'Office', payment_amount: 2000, branch_id: 'b2' }), [], 'North', AS_OF),
    buildDashboardRow(lease({ id: 'o2', lease_name: 'Archive', payment_amount: 300, lease_start_date: '2020-01-01', lease_end_date: '2022-12-31' }), [], 'Main', AS_OF),
    buildDashboardRow(lease({ id: 'o3', lease_name: 'Kiosk', payment_amount: 100, status: 'terminated', branch_id: null }), [], '', AS_OF),
  ];

  it('groups into finance then operating with matching subtotals and a grand total', () => {
    const groups = groupDashboardRows(rows);
    expect(groups.map((g) => [g.type, g.rows.map((r) => r.id)])).toEqual([
      ['finance', ['f1']],
      ['operating', ['o1', 'o2', 'o3']],
    ]);
    expect(groups[0].totals).toEqual({ count: 1, monthlyLease: 500, monthlyNonlease: 25, totalLease: 12000, totalNonlease: 600 });
    const opTotal = rows.slice(1).reduce((s, r) => s + r.totalLease, 0);
    expect(groups[1].totals.totalLease).toBe(opTotal);
    const grand = totalDashboardRows(rows);
    expect(grand.count).toBe(4);
    expect(grand.totalLease).toBe(groups[0].totals.totalLease + groups[1].totals.totalLease);
    expect(grand.totalNonlease).toBe(600);
  });

  it('defaults to active leases and filters by status, type and branch', () => {
    const ids = (f: Partial<typeof DEFAULT_DASHBOARD_FILTERS>) =>
      filterDashboardRows(rows, { ...DEFAULT_DASHBOARD_FILTERS, ...f }, AS_OF).map((r) => r.id);
    expect(ids({})).toEqual(['f1', 'o1']);
    expect(ids({ status: 'expired' })).toEqual(['o2', 'o3']);
    expect(ids({ status: 'all' })).toEqual(['f1', 'o1', 'o2', 'o3']);
    expect(ids({ type: 'operating' })).toEqual(['o1']);
    expect(ids({ branchId: 'b2', status: 'all' })).toEqual(['o1']);
    expect(ids({ branchId: 'none', status: 'all' })).toEqual(['o3']);
  });

  it('sorts by any column in both directions, keeping empty values last', () => {
    expect(sortDashboardRows(rows, 'name', 'asc').map((r) => r.id)).toEqual(['o2', 'f1', 'o3', 'o1']);
    expect(sortDashboardRows(rows, 'totalLease', 'desc').map((r) => r.id)[0]).toBe('o1');
    expect(sortDashboardRows(rows, 'monthlyNonlease', 'asc').map((r) => r.id)[0]).toBe('f1');
    expect(sortDashboardRows(rows, 'monthlyNonlease', 'desc').map((r) => r.id)[0]).toBe('f1');
  });

  it('totals an empty list to zero', () => {
    expect(totalDashboardRows([])).toEqual({ count: 0, monthlyLease: 0, monthlyNonlease: 0, totalLease: 0, totalNonlease: 0 });
    expect(groupDashboardRows([]).every((g) => g.rows.length === 0)).toBe(true);
  });
});

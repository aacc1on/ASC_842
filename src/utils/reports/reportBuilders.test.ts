import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

import type { Lease } from '../../types/lease';
import type { LeaseTransaction } from '../transactionGenerator';
import { breakdownGranularity, computeMonths, computePeriodBounds, computeWeeks, initialPeriodSelection, periodLabel, shiftPeriod, toLocalPeriodRange, type PeriodSelection } from './period';
import { buildLeaseEventEntries, buildLedgerCsv, buildPostedEntries, mergeLedgerEntries, normalizeEntryType, summarizeLedgerSlice, type DetailedLedgerEntry } from './ledger';
import { buildAssetBreakdownTransactions, buildAssetTransactionRows, defaultAssetSortDir, sortAssetRows, type ScheduleRow } from './transactionsByAsset';
import { DEFAULT_REPORT_FILTERS, defaultPortfolioSortDir, filterLeases, sortPortfolioLeases } from './portfolio';
import { breakdownTable, CF_BREAKDOWN_ROWS, monthSlices, PL_BREAKDOWN_ROWS, weekSlices } from './breakdownRows';

const lease = (over: Partial<Lease>): Lease => ({
  id: 'l1',
  lease_name: 'Alpha',
  lease_classification: 'operating',
  rou_asset: 1000,
  ...over,
} as Lease);

const base: PeriodSelection = { mode: 'month', year: 2026, month: '2026-09', week: '2026-09-07', date: '2026-09-15', customStart: '2026-08-01', customEnd: '2026-09-30' };

describe('period', () => {
  it('starts on the previous month', () => {
    const p = initialPeriodSelection(new Date(2026, 9, 12));
    expect(p).toMatchObject({ mode: 'month', year: 2026, month: '2026-09', customStart: '2026-09-01', customEnd: '2026-09-30', week: '2026-10-12', date: '2026-10-12' });
  });

  it('computes bounds for every mode', () => {
    expect(computePeriodBounds({ ...base, mode: 'year' })).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(computePeriodBounds(base)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(computePeriodBounds({ ...base, mode: 'week' })).toEqual({ start: '2026-09-07', end: '2026-09-13' });
    expect(computePeriodBounds({ ...base, mode: 'date' })).toEqual({ start: '2026-09-15', end: '2026-09-15' });
    expect(computePeriodBounds({ ...base, mode: 'custom' })).toEqual({ start: '2026-08-01', end: '2026-09-30' });
  });

  it('shifts and labels periods', () => {
    expect(shiftPeriod({ ...base, month: '2026-12' }, 1).month).toBe('2027-01');
    expect(shiftPeriod({ ...base, mode: 'year' }, -1).year).toBe(2025);
    expect(shiftPeriod({ ...base, mode: 'week' }, 1).week).toBe('2026-09-14');
    expect(shiftPeriod({ ...base, mode: 'date' }, -1).date).toBe('2026-09-14');
    expect(periodLabel(base)).toBe('September 2026');
    expect(periodLabel({ ...base, mode: 'year' })).toBe('2026');
  });

  it('slices weeks and months clipped to the range', () => {
    const weeks = computeWeeks('2026-09-01', '2026-09-30');
    expect(weeks[0]).toMatchObject({ start: '2026-09-01', end: '2026-09-06' });
    expect(weeks[weeks.length - 1]).toMatchObject({ start: '2026-09-28', end: '2026-09-30' });
    const months = computeMonths('2026-08-15', '2026-10-10');
    expect(months.map((m) => [m.start, m.end, m.shortLabel])).toEqual([
      ['2026-08-15', '2026-08-31', 'Aug'],
      ['2026-09-01', '2026-09-30', 'Sep'],
      ['2026-10-01', '2026-10-10', 'Oct'],
    ]);
  });

  it('picks the breakdown granularity', () => {
    expect(breakdownGranularity('year', '2026-01-01', '2026-12-31')).toBe('month');
    expect(breakdownGranularity('month', '2026-09-01', '2026-09-30')).toBe('week');
    expect(breakdownGranularity('custom', '2026-08-01', '2026-09-30')).toBe('month');
    expect(breakdownGranularity('custom', '2026-09-01', '2026-09-20')).toBe('week');
    expect(breakdownGranularity('date', '2026-09-01', '2026-09-01')).toBe('none');
    const { pStart, pEnd } = toLocalPeriodRange('2026-09-01', '2026-09-30');
    expect(pStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(pEnd.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });
});

describe('ledger', () => {
  const leases = [lease({ id: 'l1', branch_id: 'b1', fixed_asset_type_id: 't1' })];
  const lookups = { branches: [{ id: 'b1', branch_name: 'North' }], assetTypes: [{ id: 't1', type_name: 'Vehicle' }] } as never;
  const row = { lease_id: 'l1', description: 'd', account_debited: 'A', account_credited: 'B' };

  it('normalizes entry types', () => {
    expect(normalizeEntryType('interest_expense')).toBe('Interest Accrual');
    expect(normalizeEntryType('custom_thing')).toBe('Custom Thing');
  });

  it('builds, merges and summarizes entries', () => {
    const events = buildLeaseEventEntries([
      { ...row, transaction_date: '2026-09-10', transaction_type: 'payment', amount: 100 },
      { ...row, transaction_date: '2026-09-01', transaction_type: 'initial_recognition', amount: 5000 },
    ] as unknown as LeaseTransaction[], leases, lookups);
    expect(events.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-10']);
    expect(events[0]).toMatchObject({ leaseName: 'Alpha', branch: 'North', assetType: 'Vehicle', entryType: 'Initial Recognition' });

    const posted = buildPostedEntries([
      { ...row, transaction_date: '2026-09-05', transaction_type: 'termination', debit_amount: 7, amount: 9 },
      { ...row, transaction_date: '2026-10-02', transaction_type: 'interest', debit_amount: null, amount: 3 },
    ], leases, lookups);
    expect(posted.map((e) => e.amount)).toEqual([7, 3]);

    const merged = mergeLedgerEntries(events, posted);
    expect(merged.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-05', '2026-09-10', '2026-10-02']);
    const s = summarizeLedgerSlice(merged, '2026-09-01', '2026-09-30');
    expect([s.count, s.total, s.byType('Lease Payment'), s.other]).toEqual([3, 5107, 100, 7]);
  });

  it('writes the CSV with a total row', () => {
    const entries: DetailedLedgerEntry[] = [{ date: '2026-09-01', description: 'Say "hi"', accountDebited: 'A', accountCredited: 'B', amount: 12.5, entryType: 'Lease Payment', leaseName: 'Alpha' }];
    expect(buildLedgerCsv(entries)).toBe([
      'Date,Lease Name,Branch,Asset Type,Entry Type,Description,Account Debited,Account Credited,Amount',
      '"09/01/2026","Alpha","","","Lease Payment","Say ""hi""","A","B",12.50',
      '"TOTAL","","","","","1 entries","","",12.50',
    ].join('\n'));
  });
});

describe('transactions by asset', () => {
  const sched = (n: number, date: string, extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
    lease_id: 'l1', period_number: n, period_date: date, beginning_liability: 900 - n * 100, payment_amount: 120, interest_expense: '20',
    ending_liability: 800 - n * 100, rou_asset_balance: 1000 - n * 90, depreciation_expense: 90, ...extra,
  });
  const rows = [sched(1, '2026-08-31'), sched(2, '2026-09-30')];

  it('builds one row per lease from the schedule', () => {
    const out = buildAssetTransactionRows(rows, [lease({}), lease({ id: 'l2', lease_name: 'Empty' })], '2026-09-01');
    expect(out).toEqual([{ leaseId: 'l1', leaseName: 'Alpha', classification: 'operating', initialRecognition: 1000, accumulatedDepreciation: 180, endingRou: 820, liability: 700, interestRecognized: 20, leasePayment: 120, endingLeaseLiability: 600 }]);
  });

  it('sorts rows and picks default directions', () => {
    const a = { leaseName: 'B', endingRou: 1 } as never;
    const b = { leaseName: 'A', endingRou: 2 } as never;
    expect(sortAssetRows([a, b], 'leaseName', 'asc')).toEqual([b, a]);
    expect(sortAssetRows([a, b], 'endingRou', 'desc')).toEqual([b, a]);
    expect(defaultAssetSortDir('leaseName')).toBe('asc');
    expect(defaultAssetSortDir('liability')).toBe('desc');
  });

  it('builds the cell breakdown, skipping zero amounts and unknown columns', () => {
    const out = buildAssetBreakdownTransactions([...rows, sched(3, '2026-10-31', { interest_expense: 0 })], 'Interest Recognized');
    expect(out).toEqual([
      { date: '2026-08-31', type: 'period_1', description: 'Interest Expense — Aug 2026', amount: 20 },
      { date: '2026-09-30', type: 'period_2', description: 'Interest Expense — Sep 2026', amount: 20 },
    ]);
    expect(buildAssetBreakdownTransactions(rows, 'Nope')).toEqual([]);
  });
});

describe('portfolio', () => {
  const leases = [
    lease({ id: 'a', lease_name: 'Bravo', branch_id: 'b1', currentBalances: { currentRouAsset: 5, currentLiability: 1 } }),
    lease({ id: 'b', lease_name: 'Alpha', fixed_asset_type_id: 't1', currentBalances: { currentRouAsset: 9, currentLiability: 2 } }),
  ];

  it('sorts by text and by balance', () => {
    expect(sortPortfolioLeases(leases, 'lease_name', 'asc').map((l) => l.id)).toEqual(['b', 'a']);
    expect(sortPortfolioLeases(leases, 'rou_asset', 'asc').map((l) => l.id)).toEqual(['a', 'b']);
    expect(sortPortfolioLeases(leases, 'liability', 'desc').map((l) => l.id)).toEqual(['b', 'a']);
    expect(defaultPortfolioSortDir('lease_name')).toBe('asc');
  });

  it('filters by lease, branch and asset type including "none"', () => {
    expect(filterLeases(leases, DEFAULT_REPORT_FILTERS)).toHaveLength(2);
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, leaseName: 'b' }).map((l) => l.id)).toEqual(['b']);
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, branch: 'b1' }).map((l) => l.id)).toEqual(['a']);
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, branch: 'none' }).map((l) => l.id)).toEqual(['b']);
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, assetType: 'none' }).map((l) => l.id)).toEqual(['a']);
  });
});

describe('breakdown rows', () => {
  const pl = (n: number) => ({ operatingExpenses: { depreciationExpense: n, leaseExpense: 0, initialDirectCostsAmortized: 0, total: n }, financingCosts: { interestExpense: 1 }, gainLossOnTermination: { gain: 0, loss: 0 }, totalExpenses: n + 1 }) as never;
  const cf = { operatingActivities: { interestPaid: 1, leasePayments: 2, total: -3 }, financingActivities: { principalPayments: 4, initialDirectCostsPaid: 0, total: -4 }, netCashFlow: -7 } as never;

  it('builds week and month slices', () => {
    const w = weekSlices([{ week: { label: 'Sep 1–Sep 6', start: '2026-09-01', end: '2026-09-06' }, pl: null, cf: null }]);
    expect(w[0]).toMatchObject({ key: 'Sep 1–Sep 6', header: 'Sep 1–Sep 6' });
    const m = monthSlices([{ month: { label: 'September 2026', shortLabel: 'Sep', start: '2026-09-01', end: '2026-09-30' }, pl: null, cf: null }]);
    expect(m[0]).toMatchObject({ key: '2026-09-01', header: 'Sep' });
  });

  it('computes values and totals per row, treating missing reports as zero', () => {
    const table = breakdownTable(PL_BREAKDOWN_ROWS, [{ pl: pl(10) }, { pl: null }, { pl: pl(5) }]);
    expect(table.find((r) => r.label === 'Depreciation Expense')).toEqual({ label: 'Depreciation Expense', values: [10, 0, 5], total: 15 });
    expect(table.find((r) => r.label === 'Total Lease Expenses')?.total).toBe(17);
    const cfTable = breakdownTable(CF_BREAKDOWN_ROWS, [{ cf }]);
    expect(cfTable.find((r) => r.label === 'Net Change in Cash')?.values).toEqual([7]);
    expect(cfTable.find((r) => r.label === 'Net Operating Cash Flow')?.values).toEqual([3]);
  });
});

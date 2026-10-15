import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

vi.mock('../../lib/supabase', async () => {
  const { buildGoldenPortfolio, GOLDEN_USER } = await import('../fixtures/goldenPortfolio');
  const { createFakeSupabase } = await import('../fixtures/fakeSupabase');
  const { goldenPortfolioTotalsRpc } = await import('./goldenRpc');
  return {
    supabase: createFakeSupabase(buildGoldenPortfolio().tables, { userId: GOLDEN_USER, rpc: { get_lease_portfolio_totals: goldenPortfolioTotalsRpc } }),
  };
});

import { buildGoldenPortfolio, GOLDEN_AS_OF, GOLDEN_TODAY } from '../fixtures/goldenPortfolio';
import { loadFinancialSnapshot, loadMonthReports, loadWeekReports } from '../../utils/reports/financialSnapshot';
import { buildLedgerCsv, summarizeLedgerSlice } from '../../utils/reports/ledger';
import { computeMonths, computePeriodBounds, computeWeeks, initialPeriodSelection, periodLabel } from '../../utils/reports/period';
import { buildAssetBreakdownTransactions, buildAssetTransactionRows, sortAssetRows, type ScheduleRow } from '../../utils/reports/transactionsByAsset';
import { DEFAULT_REPORT_FILTERS, filterLeases, sortPortfolioLeases } from '../../utils/reports/portfolio';
import { breakdownTable, CF_BREAKDOWN_ROWS, monthSlices, PL_BREAKDOWN_ROWS, weekSlices } from '../../utils/reports/breakdownRows';
import type { AssetTypeOption, BranchOption } from '../../components/reports/types';

const { leases, tables } = buildGoldenPortfolio();
const lookups = { branches: tables.branches as unknown as BranchOption[], assetTypes: tables.fixed_asset_types as unknown as AssetTypeOption[] };
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
});
afterAll(() => vi.useRealTimers());

describe('golden master: report builders on the fixture portfolio', () => {
  it('period selection and bounds', () => {
    const p = initialPeriodSelection(new Date());
    expect({ p, bounds: computePeriodBounds(p), label: periodLabel(p) }).toMatchSnapshot();
    expect({ weeks: computeWeeks('2026-09-01', GOLDEN_AS_OF), months: computeMonths('2026-01-01', '2026-12-31') }).toMatchSnapshot();
  });

  it('financial snapshot for September 2026', async () => {
    expect(json(await loadFinancialSnapshot(leases, leases, '2026-09-01', GOLDEN_AS_OF, lookups))).toMatchSnapshot();
  });

  it('posted ledger for January-June 2026, with CSV and monthly ledger summaries', async () => {
    const { detailedLedger } = await loadFinancialSnapshot(leases, leases, '2026-01-01', '2026-06-30', lookups);
    expect(detailedLedger.length).toBeGreaterThan(0);
    expect(json(detailedLedger)).toMatchSnapshot();
    expect(buildLedgerCsv(detailedLedger)).toMatchSnapshot();
    const months = computeMonths('2026-01-01', '2026-06-30').map((m) => {
      const s = summarizeLedgerSlice(detailedLedger, m.start, m.end);
      return { month: m.label, count: s.count, total: s.total, payments: s.byType('Lease Payment'), interest: s.byType('Interest Accrual'), other: s.other };
    });
    expect(months).toMatchSnapshot();
  });

  it('weekly P&L and cash flow breakdown for September 2026', async () => {
    const slices = weekSlices(await loadWeekReports(leases, '2026-09-01', GOLDEN_AS_OF));
    expect({ pl: breakdownTable(PL_BREAKDOWN_ROWS, slices), cf: breakdownTable(CF_BREAKDOWN_ROWS, slices) }).toMatchSnapshot();
  });

  it('monthly P&L and cash flow breakdown for 2026', async () => {
    const slices = monthSlices(await loadMonthReports(leases, '2026-01-01', '2026-12-31'));
    expect({ headers: slices.map((s) => s.header), pl: breakdownTable(PL_BREAKDOWN_ROWS, slices), cf: breakdownTable(CF_BREAKDOWN_ROWS, slices) }).toMatchSnapshot();
  });

  it('transactions by asset for September 2026, with a cell breakdown', () => {
    const sched = (tables.amortization_schedules as unknown as ScheduleRow[])
      .filter((r) => r.period_date <= GOLDEN_AS_OF)
      .sort((a, b) => a.period_number - b.period_number);
    const rows = buildAssetTransactionRows(sched, leases, '2026-09-01');
    expect(json(sortAssetRows(rows, 'endingRou', 'desc'))).toMatchSnapshot();
    const first = sched.filter((r) => r.lease_id === leases[0].id && r.period_date >= '2026-09-01');
    expect(buildAssetBreakdownTransactions(first, 'Interest Recognized')).toMatchSnapshot();
  });

  it('portfolio sorting and filtering', () => {
    expect(sortPortfolioLeases(leases, 'liability', 'desc').map((l) => l.lease_name)).toMatchSnapshot();
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, branch: 'br-1' }).map((l) => l.lease_name)).toMatchSnapshot();
    expect(filterLeases(leases, { ...DEFAULT_REPORT_FILTERS, assetType: 'none' }).map((l) => l.lease_name)).toMatchSnapshot();
  });
});

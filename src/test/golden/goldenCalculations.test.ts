import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

const xlsxCalls = vi.hoisted(() => [] as unknown[]);

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: (rows: unknown) => { xlsxCalls.push(rows); return { rows }; },
    book_new: () => ({}),
    book_append_sheet: () => undefined,
  },
  writeFile: (_wb: unknown, name: string) => { xlsxCalls.push(name); },
}));

vi.mock('../../lib/supabase', async () => {
  const { buildGoldenPortfolio, GOLDEN_USER, GOLDEN_RECONCILIATION_ROWS, GOLDEN_DATA_HEALTH_ROWS } = await import('../fixtures/goldenPortfolio');
  const { createFakeSupabase } = await import('../fixtures/fakeSupabase');
  const { goldenPortfolioTotalsRpc } = await import('./goldenRpc');
  return {
    supabase: createFakeSupabase(buildGoldenPortfolio().tables, {
      userId: GOLDEN_USER,
      rpc: {
        get_ledger_reconciliation: () => GOLDEN_RECONCILIATION_ROWS,
        get_data_health: () => GOLDEN_DATA_HEALTH_ROWS,
        get_platform_data_health: () => GOLDEN_DATA_HEALTH_ROWS,
        get_lease_portfolio_totals: goldenPortfolioTotalsRpc,
      },
    }),
  };
});

import { buildGoldenPortfolio, GOLDEN_AS_OF, GOLDEN_TODAY } from '../fixtures/goldenPortfolio';
import {
  generateBalanceSheet,
  generateProfitLoss,
  generateCashFlow,
  generateProfitLossAndCashFlow,
  computeLeaseCostDisclosure,
  computeLeaseBalancesByType,
  computeMaturityAnalysis,
  fetchRemainingLiabilityFromSchedule,
  computeScheduleBalances,
  findFirstUnpostedMonth,
} from '../../utils/financialReports';
import { getAllTransactions, getTransactionsByLease } from '../../utils/transactionGenerator';
import { batchCalculateCurrentBalances } from '../../utils/currentBalances';
import { summarizePortfolio } from '../../utils/portfolioOverview';
import { determineLeaseClassification } from '../../utils/leaseClassification';
import { fetchLedgerReconciliation, fetchDataHealth } from '../../utils/ledgerHealth';
import { fetchPortfolioTotals, sumPortfolioTotals } from '../../utils/portfolioTotals';
import { generateMonthEndTransactionsWithSkips, summarizeMonthEndTransactions } from '../../utils/monthEndTransactions';
import { buildStoredSchedulesForLeases } from '../../utils/testScheduleHelper';
import { exportToCsv, downloadLedgerCSV } from '../../utils/csvExport';
import { downloadExcel } from '../../utils/exportTransactionsExcel';
import { fetchLeaseBalancesAsOf } from '../../utils/leaseBalanceAsOf';
import { supabase } from '../../lib/supabase';
import type { Transaction } from '../../components/transactions/types';

const { leases } = buildGoldenPortfolio();
const asOf = new Date(2026, 8, 30, 23, 59, 59, 999);
const yearStart = new Date(2026, 0, 1, 0, 0, 0, 0);
const yearEnd = new Date(2026, 11, 31, 23, 59, 59, 999);
const sepStart = new Date(2026, 8, 1, 0, 0, 0, 0);
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));

async function captureBlobs(run: () => void | Promise<void>): Promise<string[]> {
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blobs.push(b as Blob); return 'blob:golden'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await run();
  return Promise.all(blobs.map((b) => b.text()));
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
});
afterAll(() => vi.useRealTimers());

describe('golden master: calculations on the fixture portfolio', () => {
  it('fixture is deterministic', () => {
    const { tables } = buildGoldenPortfolio();
    expect(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))).toMatchSnapshot();
    expect(json(leases.map((l) => ({ id: l.id, name: l.lease_name, rou: l.rou_asset, liability: l.lease_liability, end: l.lease_end_date })))).toMatchSnapshot();
  });

  it('balance sheet as of 2026-09-30 (incl. current / non-current)', async () => {
    expect(json(await generateBalanceSheet(leases, asOf))).toMatchSnapshot();
  });

  it('balances by lease type as of 2026-09-30', async () => {
    expect(json(await computeLeaseBalancesByType(leases, asOf))).toMatchSnapshot();
  });

  it('schedule balances and remaining liability', async () => {
    expect(json(await computeScheduleBalances(leases, GOLDEN_AS_OF))).toMatchSnapshot();
    expect(json(await fetchRemainingLiabilityFromSchedule(leases, asOf))).toMatchSnapshot();
    expect(json(await fetchLeaseBalancesAsOf(leases.map((l) => l.id), GOLDEN_AS_OF))).toMatchSnapshot();
  });

  it('first unposted month', async () => {
    expect(await findFirstUnpostedMonth('2024-01-01', GOLDEN_AS_OF)).toMatchSnapshot();
  });

  it('P&L and cash flow for 2026 (year)', async () => {
    expect(json(await generateProfitLossAndCashFlow(leases, yearStart, yearEnd))).toMatchSnapshot();
  });

  it('P&L and cash flow for September 2026 (month)', async () => {
    expect(json(await generateProfitLossAndCashFlow(leases, sepStart, asOf))).toMatchSnapshot();
  });

  it('P&L and cash flow monthly breakdown for 2026', async () => {
    const months = [];
    for (let m = 0; m < 12; m++) {
      const { pl, cf } = await generateProfitLossAndCashFlow(leases, new Date(2026, m, 1), new Date(2026, m + 1, 0));
      months.push({ month: m + 1, pl, cf });
    }
    expect(json(months)).toMatchSnapshot();
  });

  it('standalone P&L and cash flow generators for 2025', async () => {
    const s = new Date(2025, 0, 1);
    const e = new Date(2025, 11, 31, 23, 59, 59, 999);
    expect(json({ pl: await generateProfitLoss(leases, s, e), cf: await generateCashFlow(leases, s, e) })).toMatchSnapshot();
  });

  it('transaction ledger sources (lease events)', async () => {
    expect(json(await getAllTransactions(yearStart, yearEnd))).toMatchSnapshot();
    expect(json(await getTransactionsByLease(leases[5].id))).toMatchSnapshot();
  });

  it('quantitative disclosures: lease cost components for 2026 YTD', async () => {
    expect(json(await computeLeaseCostDisclosure(leases, yearStart, asOf))).toMatchSnapshot();
  });

  it('maturity analysis (finance / operating) as of 2026-09-30', async () => {
    expect(json(await computeMaturityAnalysis(leases, asOf))).toMatchSnapshot();
  });

  it('classification test per lease', () => {
    expect(json(leases.map((l) => ({
      lease: l.lease_name,
      result: determineLeaseClassification({
        transferOwnership: l.transfer_ownership,
        purchaseOption: l.purchase_option,
        leaseTermMonths: l.lease_term_months,
        assetEconomicLifeMonths: l.asset_economic_life_months,
        presentValueOfPayments: Number(l.lease_liability) || 0,
        assetFairValue: l.asset_fair_value,
        specializedAsset: l.specialized_asset,
      } as never),
    })))).toMatchSnapshot();
  });

  it('portfolio overview, current balances and dashboard totals', async () => {
    const balances = await batchCalculateCurrentBalances(leases);
    const withBalances = leases.map((l) => ({ ...l, currentBalances: balances.get(l.id) }));
    expect(json(balances)).toMatchSnapshot();
    expect(json(summarizePortfolio(withBalances))).toMatchSnapshot();
    const totals = await fetchPortfolioTotals({ search: '', leaseType: 'all', lessorType: 'all', branchId: 'all', status: 'all' });
    expect(json({ totals, sum: totals ? sumPortfolioTotals(totals) : null })).toMatchSnapshot();
  });

  it('ledger reconciliation and data health', async () => {
    expect(json(await fetchLedgerReconciliation('2000-01-01', GOLDEN_AS_OF))).toMatchSnapshot();
    expect(json(await fetchLedgerReconciliation('2000-01-01', GOLDEN_AS_OF, true))).toMatchSnapshot();
    expect(json(await fetchDataHealth('organization'))).toMatchSnapshot();
    expect(json(await fetchDataHealth('platform'))).toMatchSnapshot();
    expect(json((supabase as unknown as { calls: unknown[] }).calls.filter((c) => (c as { fn: string }).fn !== 'get_lease_balances_as_of'))).toMatchSnapshot();
  });

  it('month-end transactions for the unposted months', () => {
    const schedules = buildStoredSchedulesForLeases(leases);
    const out = ['2026-07', '2026-08', '2026-09'].map((p) => {
      const r = generateMonthEndTransactionsWithSkips(leases, p, schedules);
      return { period: p, ...r, summary: summarizeMonthEndTransactions(r.transactions) };
    });
    expect(json(out)).toMatchSnapshot();
  });

  it('CSV export row builders', async () => {
    const entries = leases.slice(0, 3).map((l, i) => ({
      date: `2026-09-${String(10 + i)}`, description: `=SUM(${i}) ${l.lease_name}`, accountDebited: 'Interest Expense',
      accountCredited: 'Lease Liability, current', amount: 100.5 * (i + 1), entryType: 'Interest Accrual',
      leaseName: l.lease_name, branch: 'North "A"', assetType: 'Property',
    }));
    const csv = await captureBlobs(() => {
      downloadLedgerCSV(entries, '2026-09-01', GOLDEN_AS_OF);
      exportToCsv('x.csv', ['A', 'B'], [['+1', 2], [null, 'line\nbreak']]);
    });
    expect(csv).toMatchSnapshot();
  });

  it('Excel export row builder', async () => {
    const txns = [1, 2].map((i) => ({
      id: `t${i}`, lease_id: leases[0].id, transaction_date: `2026-09-${10 + i}`, transaction_type: 'interest_expense',
      account_debited: 'Interest Expense', account_credited: '-Lease Liability', debit_amount: 12.34 * i, credit_amount: 12.34 * i,
      description: `@row ${i}`, reference_number: `R${i}`, period: '2026-09', is_reversed: false, created_at: '2026-09-30T00:00:00Z',
      leases: { lease_name: leases[0].lease_name },
    })) as unknown as Transaction[];
    xlsxCalls.length = 0;
    await downloadExcel(txns);
    expect(json(xlsxCalls)).toMatchSnapshot();
  });
});

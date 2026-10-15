import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

vi.mock('../lib/supabase', async () => {
  const { buildGoldenPortfolio, GOLDEN_USER } = await import('./fixtures/goldenPortfolio');
  const { createFakeSupabase } = await import('./fixtures/fakeSupabase');
  const { goldenPortfolioTotalsRpc } = await import('./golden/goldenRpc');
  return { supabase: createFakeSupabase(buildGoldenPortfolio().tables, { userId: GOLDEN_USER, rpc: { get_lease_portfolio_totals: goldenPortfolioTotalsRpc } }) };
});

const baseData = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../hooks/reports/useReportsBaseData', () => ({ useReportsBaseData: () => baseData.current }));

import { buildGoldenPortfolio, GOLDEN_AS_OF } from './fixtures/goldenPortfolio';
import { loadFinancialSnapshot, loadMonthReports } from '../utils/reports/financialSnapshot';
import { buildAssetTransactionRows, type ScheduleRow } from '../utils/reports/transactionsByAsset';
import { summarizePortfolio } from '../utils/portfolioOverview';
import { DEFAULT_PORTFOLIO_VIEW } from '../utils/reports/portfolio';
import type { TransactionsByAssetData } from '../hooks/reports/useTransactionsByAssetData';
import { BalanceSheetReport } from '../components/reports/BalanceSheet/BalanceSheetReport';
import { ProfitLossReport } from '../components/reports/ProfitAndLoss/ProfitLossReport';
import { CashFlowReport } from '../components/reports/CashFlow/CashFlowReport';
import { TransactionLedgerReport } from '../components/reports/TransactionLedger/TransactionLedgerReport';
import { TransactionsByAssetReport } from '../components/reports/TransactionsByAsset/TransactionsByAssetReport';
import { PortfolioOverview } from '../components/reports/PortfolioOverview/PortfolioOverview';
import { ReportsView } from '../components/reports/ReportsView';

const { leases, tables } = buildGoldenPortfolio();
const lookups = { branches: [], assetTypes: [] };
let snap: Awaited<ReturnType<typeof loadFinancialSnapshot>>;
let monthReports: Awaited<ReturnType<typeof loadMonthReports>>;

beforeAll(async () => {
  snap = await loadFinancialSnapshot(leases, leases, '2026-01-01', GOLDEN_AS_OF, lookups);
  monthReports = await loadMonthReports(leases, '2026-01-01', GOLDEN_AS_OF);
  baseData.current = { leases, report: summarizePortfolio(leases), loading: false, userId: 'u1', branchOptions: [], assetTypeOptions: [], reload: vi.fn() };
});

const breakdowns = () => ({ weekReports: [], weekReportsLoading: false, monthReports, monthReportsLoading: false });

describe('report components render with real data', () => {
  it('balance sheet', async () => {
    render(<BalanceSheetReport balanceSheet={snap.balanceSheet} periodEnd={GOLDEN_AS_OF} />);
    expect(await screen.findByText('Balance Sheet')).toBeTruthy();
    expect((await screen.findAllByText('Liabilities')).length).toBeGreaterThan(0);
  });

  it('profit and loss with monthly breakdown', async () => {
    render(<ProfitLossReport profitLoss={snap.profitLoss} {...breakdowns()} />);
    expect(await screen.findByText('Profit & Loss Statement')).toBeTruthy();
    expect((await screen.findAllByText('Total Lease Expenses')).length).toBeGreaterThan(0);
  });

  it('cash flow with monthly breakdown', async () => {
    render(<CashFlowReport cashFlow={snap.cashFlow} {...breakdowns()} />);
    expect(await screen.findByText('Cash Flow Statement')).toBeTruthy();
    expect((await screen.findAllByText('Net Change in Cash')).length).toBeGreaterThan(0);
  });

  it('transaction ledger', async () => {
    render(
      <TransactionLedgerReport
        periodStart="2026-01-01"
        periodEnd={GOLDEN_AS_OF}
        detailedLedger={snap.detailedLedger}
        ledgerPage={1}
        ledgerPageSize={50}
        setLedgerPage={vi.fn()}
        setLedgerPageSize={vi.fn()}
        weekReports={[]}
        monthReports={monthReports}
      />,
    );
    expect(await screen.findByText('Transaction Ledger')).toBeTruthy();
    expect(await screen.findByText('Accounting Legend')).toBeTruthy();
  });

  it('transactions by asset', async () => {
    const sched = (tables.amortization_schedules as unknown as ScheduleRow[]).filter((r) => r.period_date <= GOLDEN_AS_OF).sort((a, b) => a.period_number - b.period_number);
    const rows = buildAssetTransactionRows(sched, leases, '2026-01-01');
    const data = {
      assetTransactions: rows, sortedAssetTransactions: rows, assetTxnLoading: false, assetTxnFullscreen: false, setAssetTxnFullscreen: vi.fn(),
      assetSortKey: 'leaseName', assetSortDir: 'asc', handleAssetSort: vi.fn(), loadAssetBreakdown: vi.fn(), assetBreakdown: null, setAssetBreakdown: vi.fn(),
    } as unknown as TransactionsByAssetData;
    render(<TransactionsByAssetReport periodStart="2026-01-01" periodEnd={GOLDEN_AS_OF} {...data} />);
    expect(await screen.findByText('Transaction by Assets')).toBeTruthy();
    expect((await screen.findAllByText(rows[0].leaseName)).length).toBeGreaterThan(0);
  });

  it('portfolio overview', async () => {
    render(<PortfolioOverview report={summarizePortfolio(leases)} leases={leases} view={DEFAULT_PORTFOLIO_VIEW} onViewChange={vi.fn()} />);
    expect(await screen.findByText('Total Leases')).toBeTruthy();
    expect((await screen.findAllByText(leases[0].lease_name)).length).toBeGreaterThan(0);
  });

  it('reports page with a mocked data hook', async () => {
    render(<MemoryRouter><ReportsView /></MemoryRouter>);
    expect(await screen.findByText('Lease Portfolio Reports')).toBeTruthy();
    expect(await screen.findByText('Total Leases')).toBeTruthy();
  });
});

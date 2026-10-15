import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Lease } from '../types/lease';

const rpcMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock('../components/toastContextTypes', () => ({
  useToast: () => ({ showToast: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
}));

import {
  buildPortfolioTotalsParams,
  fetchPortfolioTotals,
  parsePortfolioTotals,
  sumPortfolioTotals,
  type PortfolioTotals,
} from '../utils/portfolioTotals';
import { LeaseList } from '../components/LeaseList';

const TOP_CARD_ROU = 828828.43;
const TOP_CARD_LIABILITY = 899321.45;

const SERVER_ROWS = [
  { bucket: 'finance', lease_count: '22', total_rou: '763129.97', total_liability: '833622.99' },
  { bucket: 'operating', lease_count: '3', total_rou: '65698.46', total_liability: '65698.46' },
];

function makeLease(i: number, classification: 'finance' | 'operating', extra: Partial<Lease> = {}): Lease {
  return {
    id: `lease-${i}`,
    lease_name: `Vehicle ${i}`,
    lessor_name: 'Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2025-01-01',
    lease_end_date: '2028-01-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    lease_classification: classification,
    rou_asset: 1000,
    lease_liability: 1000,
    status: 'active',
    accounting_treatment: 'recognized',
    currentBalances: { currentRouAsset: 1000, currentLiability: 1000, balanceStatus: 'active' },
    ...extra,
  } as Lease;
}

const pageOfTen = [
  ...Array.from({ length: 9 }, (_, i) => makeLease(i + 1, 'finance')),
  makeLease(10, 'operating'),
];

const column = (key: string) => screen.getByTestId(`kanban-column-${key}`);
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('portfolio totals helpers', () => {
  beforeEach(() => rpcMock.mockReset());

  it('maps dashboard filters to server parameters', () => {
    expect(buildPortfolioTotalsParams({ companyId: 'c1', search: '  bmw ', leaseType: 'finance', lessorType: 'corporate', branchId: 'b1' })).toEqual({
      p_company_id: 'c1',
      p_search: 'bmw',
      p_lease_type: 'finance',
      p_lessor_type: 'corporate',
      p_branch_id: 'b1',
      p_branch_unassigned: false,
      p_status: null,
      p_missing_classification: false,
    });
    expect(buildPortfolioTotalsParams({ search: '', leaseType: 'all', lessorType: 'all', branchId: 'all', status: 'active', missingClassificationOnly: true })).toMatchObject({
      p_status: 'active',
      p_missing_classification: true,
    });
    expect(buildPortfolioTotalsParams({ companyId: null, search: '', leaseType: 'all', lessorType: 'all', branchId: 'none' })).toEqual({
      p_company_id: null,
      p_search: null,
      p_lease_type: null,
      p_lessor_type: null,
      p_branch_id: null,
      p_branch_unassigned: true,
      p_status: null,
      p_missing_classification: false,
    });
  });

  it('parses server rows and the buckets tie to the top cards', () => {
    const totals = parsePortfolioTotals(SERVER_ROWS)!;
    expect(totals.finance).toEqual({ count: 22, rou: 763129.97, liability: 833622.99 });
    expect(totals.operating).toEqual({ count: 3, rou: 65698.46, liability: 65698.46 });
    expect(totals.shortTerm).toEqual({ count: 0, rou: 0, liability: 0 });
    expect(sumPortfolioTotals(totals)).toEqual({ count: 25, rou: TOP_CARD_ROU, liability: TOP_CARD_LIABILITY });
  });

  it('returns null for malformed data', () => {
    expect(parsePortfolioTotals(null)).toBeNull();
    expect(parsePortfolioTotals({})).toBeNull();
  });

  it('fetches via the org-scoped RPC and returns null on error', async () => {
    rpcMock.mockResolvedValueOnce({ data: SERVER_ROWS, error: null });
    const ok = await fetchPortfolioTotals({ companyId: 'c1', search: '', leaseType: 'all', lessorType: 'all', branchId: 'all' });
    expect(rpcMock).toHaveBeenCalledWith('get_lease_portfolio_totals', expect.objectContaining({ p_company_id: 'c1' }));
    expect(ok?.finance.count).toBe(22);

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await fetchPortfolioTotals({ companyId: 'c1', search: '', leaseType: 'all', lessorType: 'all', branchId: 'all' })).toBeNull();
  });
});

describe('Kanban column totals with more leases than one page', () => {
  it('uses totals for all matching leases, not just the 10 loaded', () => {
    render(<LeaseList leases={pageOfTen} viewMode="kanban" portfolioTotals={parsePortfolioTotals(SERVER_ROWS)} onViewSchedule={vi.fn()} />);

    const fin = within(column('finance'));
    expect(fin.getByTestId('kanban-column-count').textContent).toBe('22');
    expect(fin.getByTestId('kanban-column-rou').textContent).toBe(money(763129.97));
    expect(fin.getByTestId('kanban-column-liability').textContent).toBe(money(833622.99));
    expect(fin.getByText(/all 22 matching leases; 9 shown on this page/)).toBeTruthy();

    const op = within(column('operating'));
    expect(op.getByTestId('kanban-column-count').textContent).toBe('3');
    expect(op.getByTestId('kanban-column-rou').textContent).toBe(money(65698.46));

    expect(screen.queryByText(/\(this page\)/)).toBeNull();
    expect(screen.queryByTestId('kanban-column-shortTerm')).toBeNull();
    expect(fin.getByRole('tooltip').textContent).toMatch(/^Balances are taken from each lease schedule as of the selected date/);
  });

  it('labels per-page sums "(this page)" when filtered totals are unavailable', () => {
    render(<LeaseList leases={pageOfTen} viewMode="kanban" portfolioTotals={null} onViewSchedule={vi.fn()} />);
    const fin = within(column('finance'));
    expect(fin.getByTestId('kanban-column-count').textContent).toBe('9');
    expect(fin.getByTestId('kanban-column-rou').textContent).toBe(money(9000));
    expect(fin.getByText('ROU Total (this page)')).toBeTruthy();
    expect(fin.getByText('Liability Total (this page)')).toBeTruthy();
  });

  it('shows short-term leases in their own column so finance + operating stay recognized-only', () => {
    const totals: PortfolioTotals = {
      ...parsePortfolioTotals(SERVER_ROWS)!,
      shortTerm: { count: 2, rou: 0, liability: 0 },
    };
    const leases = [...pageOfTen, makeLease(11, 'operating', { accounting_treatment: 'short_term_exemption' })];
    render(<LeaseList leases={leases} viewMode="kanban" portfolioTotals={totals} onViewSchedule={vi.fn()} />);
    expect(within(column('shortTerm')).getByTestId('kanban-column-count').textContent).toBe('2');
    expect(within(column('operating')).getByText(/all 3 matching leases; 1 shown/)).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createFakeSupabase, type FakeSupabaseOptions } from './fixtures/fakeSupabase';
import { GOLDEN_ORG, type Tables } from './fixtures/goldenPortfolio';
import { currentOrgId } from '../utils/currentOrg';
import type { UserPermissions } from '../App';
import { MonthEndDocumentsView } from '../components/MonthEndDocumentsView';
import { DocumentsView } from '../components/DocumentsView';
import { Dashboard } from '../components/Dashboard';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

vi.mock('../components/toastContextTypes', () => ({
  useToast: () => ({ showToast: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
}));

vi.mock('../hooks/useDashboardData', async () => {
  const { useState } = await import('react');
  return {
    useDashboardData: () => {
      const [leases, setLeases] = useState<unknown[]>([]);
      const [loading, setLoading] = useState(true);
      return {
        userId: 'u1', leases, loading, error: null, handleDelete: vi.fn(), setLeases, setLoading,
      };
    },
  };
});

vi.mock('../utils/portfolioTotals', async (orig) => ({
  ...(await orig<typeof import('../utils/portfolioTotals')>()),
  fetchPortfolioTotals: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../utils/currentBalances', () => ({
  batchCalculateCurrentBalances: vi.fn(() => Promise.resolve(new Map())),
}));

const ADMIN_PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: false,
  access_user_management: false,
};

const OTHER_ORG = '00000000-0000-0000-0000-0000000000b2';

function seed(opts: Partial<FakeSupabaseOptions> = {}) {
  const tables: Tables = {
    month_end_documents: [
      { id: 'd1', period: '2026-08', period_label: 'August 2026 close', status: 'posted', transaction_count: 0, total_debits: 0, total_credits: 0, organization_id: GOLDEN_ORG, entries: [], created_at: '2026-09-01' },
      { id: 'dx', period: '2026-07', period_label: 'Foreign close', status: 'posted', transaction_count: 0, total_debits: 0, total_credits: 0, organization_id: OTHER_ORG, entries: [], created_at: '2026-08-01' },
    ],
    month_end_catch_up_batches: [],
    documents: [
      { id: 'f1', file_name: 'lease-a.pdf', category: 'Lease Agreements', organization_id: GOLDEN_ORG, created_at: '2026-09-01' },
      { id: 'fx', file_name: 'foreign.pdf', category: 'Lease Agreements', organization_id: OTHER_ORG, created_at: '2026-09-01' },
    ],
    leases: [
      { id: 'l1', lease_name: 'Head Office', organization_id: GOLDEN_ORG, status: 'active', created_at: '2026-01-01', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31', monthly_payment: 1000, lease_term_months: 60 },
      { id: 'lx', lease_name: 'Foreign Lease', organization_id: OTHER_ORG, status: 'active', created_at: '2026-01-01', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31', monthly_payment: 1000, lease_term_months: 60 },
    ],
    branches: [],
    contract_modifications: [],
    transactions: [],
    fixed_asset_types: [],
  };
  const fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
  return fake;
}

beforeEach(() => {
  vi.mocked(currentOrgId).mockResolvedValue(GOLDEN_ORG);
});

describe('month-end documents screen', () => {
  it('shows only the current organization documents', async () => {
    seed();
    render(<MonthEndDocumentsView />);
    expect(await screen.findByText(/August 2026 close/)).toBeInTheDocument();
    expect(screen.queryByText(/Foreign close/)).not.toBeInTheDocument();
  });

  it('shows an inline error with a working Retry instead of an empty list', async () => {
    const fake = seed({ failures: { select: { month_end_documents: 'boom' } } });
    render(<MonthEndDocumentsView />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    delete fake.failures.select!.month_end_documents;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/August 2026 close/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ends loading and shows the error when the organization cannot be resolved', async () => {
    seed();
    vi.mocked(currentOrgId).mockRejectedValueOnce(Object.assign(new Error('Your session has expired.'), { status: 401 }));
    render(<MonthEndDocumentsView />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('documents screen', () => {
  it('shows an inline error with a working Retry instead of an empty file list', async () => {
    const fake = seed({ failures: { select: { documents: 'boom' } } });
    render(<DocumentsView userRole="admin" permissions={ADMIN_PERMISSIONS} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    delete fake.failures.select!.documents;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('lease-a.pdf')).toBeInTheDocument();
    expect(screen.queryByText('foreign.pdf')).not.toBeInTheDocument();
  });
});

describe('lease portfolio screen', () => {
  const renderDashboard = () => render(
    <MemoryRouter>
      <Dashboard userRole="admin" permissions={ADMIN_PERMISSIONS} selectedCompanyId={null} />
    </MemoryRouter>,
  );

  it('shows an inline error with a working Retry when the leases fail to load', async () => {
    const fake = seed({ failures: { select: { leases: 'boom' } } });
    renderDashboard();
    // Both the portfolio list and the lease dashboard read leases, so each shows its own banner.
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.queryByText(/Loading leases/)).not.toBeInTheDocument();
    delete fake.failures.select!.leases;
    screen.getAllByRole('button', { name: /retry/i }).forEach((b) => fireEvent.click(b));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect((await screen.findAllByText('Head Office')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Foreign Lease')).not.toBeInTheDocument();
  });

  it('shows a Retry banner when the branch filter cannot be loaded', async () => {
    seed({ failures: { select: { branches: 'boom' } } });
    renderDashboard();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
  });
});

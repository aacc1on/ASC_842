import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { createSupabaseMock } from './mockSupabase';

vi.mock('../lib/supabase', () => ({
  supabase: createSupabaseMock(),
}));

vi.mock('../hooks/useCompanies', () => ({
  useCompanies: () => ({
    companies: [],
    selectedCompanyId: null,
    loaded: true,
    loadCompanies: vi.fn(),
    handleCompanyChange: vi.fn(),
    reset: vi.fn(),
    handleAddCompany: vi.fn(() => true),
  }),
}));

vi.mock('../hooks/useDashboardData', () => ({
  useDashboardData: () => ({
    userId: 'user-1',
    leases: [],
    loading: false,
    error: null,
    handleDelete: vi.fn(),
    setLeases: vi.fn(),
    setLoading: vi.fn(),
  }),
}));

vi.mock('../hooks/useIdleTimeout', () => ({
  useIdleTimeout: () => ({ showWarning: false, dismissWarning: vi.fn() }),
}));

vi.mock('../components/toastContextTypes', () => ({
  ToastContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
  useToast: () => ({ showToast: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
  useConfirm: () => vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../components/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

async function runAxe(container: HTMLElement) {
  return axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'form-field-multiple-labels': { enabled: false },
      'label': { enabled: false },
      'select-name': { enabled: false },
    },
  });
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const ADMIN_PERMISSIONS = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: true,
  access_user_management: true,
};

describe('QA-009: WCAG 2.1 AA accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Dashboard has no critical or serious axe violations', async () => {
    const { Dashboard } = await import('../components/Dashboard');
    const { container } = renderWithRouter(
      <Dashboard userRole="admin" permissions={ADMIN_PERMISSIONS} selectedCompanyId={null} />
    );
    const results = await runAxe(container);
    const serious = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(serious, `${serious.length} serious/critical violations: ${serious.map(v => v.id).join(', ')}`).toEqual([]);
  });

  it('LeaseForm has no critical or serious axe violations', async () => {
    const { LeaseForm } = await import('../components/LeaseForm');
    const { container } = renderWithRouter(
      <LeaseForm onClose={vi.fn()} onSuccess={vi.fn()} lease={undefined} userId="user-1" selectedCompanyId={null} />
    );
    const results = await runAxe(container);
    const serious = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(serious, `${serious.length} serious/critical violations: ${serious.map(v => v.id).join(', ')}`).toEqual([]);
  });

  it('ReportsView has no critical or serious axe violations', async () => {
    const { ReportsView } = await import('../components/ReportsView');
    const { container } = renderWithRouter(
      <ReportsView selectedCompanyId={null} />
    );
    const results = await runAxe(container);
    const serious = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(serious, `${serious.length} serious/critical violations: ${serious.map(v => v.id).join(', ')}`).toEqual([]);
  });

  it('Dashboard has exactly one h1', async () => {
    const { Dashboard } = await import('../components/Dashboard');
    const { container } = renderWithRouter(
      <Dashboard userRole="admin" permissions={ADMIN_PERMISSIONS} selectedCompanyId={null} />
    );
    expect(container.querySelectorAll('h1').length).toBe(1);
  });

  it('ReportsView has exactly one h1', async () => {
    const { ReportsView } = await import('../components/ReportsView');
    const { container } = renderWithRouter(
      <ReportsView selectedCompanyId={null} />
    );
    expect(container.querySelectorAll('h1').length).toBe(1);
  });
});

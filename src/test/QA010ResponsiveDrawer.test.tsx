import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

describe('QA-010: Responsive mobile drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hamburger button has aria-label "Open menu" and aria-expanded', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    expect(hamburger).toBeTruthy();
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking hamburger opens the drawer with role=dialog', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    const { container } = renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    fireEvent.click(hamburger);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('clicking a nav link closes the drawer', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    const { container } = renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    fireEvent.click(hamburger);
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    const navButtons = container.querySelectorAll('button');
    const leaseButton = Array.from(navButtons).find(b => b.textContent?.includes('Lease Accounting'));
    expect(leaseButton).toBeTruthy();
    fireEvent.click(leaseButton!);
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('clicking the backdrop closes the drawer', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    const { container } = renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    fireEvent.click(hamburger);
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    const backdrop = container.querySelector('.bg-black\\/50');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('pressing Escape closes the drawer', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    const { container } = renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    fireEvent.click(hamburger);
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('aria-expanded toggles when drawer opens and closes', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    renderWithRouter(
      <MenuBar
        onLogout={vi.fn()}
        userEmail="test@test.com"
        userRole="admin"
        permissions={ADMIN_PERMISSIONS}
        companies={[]}
        selectedCompanyId={null}
        onCompanyChange={vi.fn()}
        onCompaniesUpdated={vi.fn()}
        planKey="enterprise"
      />
    );
    const hamburger = screen.getByLabelText('Open menu');
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
  });
});

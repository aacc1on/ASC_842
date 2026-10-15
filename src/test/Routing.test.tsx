import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Navigate } from 'react-router-dom';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';

describe('Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects / to /leases', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Navigate to="/leases" replace />} />
          <Route path="/leases" element={<div data-testid="leases-page">Leases</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('leases-page')).toBeInTheDocument();
  });

  it('renders an unknown path redirect to /leases', () => {
    render(
      <MemoryRouter initialEntries={['/nonexistent']}>
        <Routes>
          <Route path="/leases" element={<div data-testid="leases-page">Leases</div>} />
          <Route path="*" element={<Navigate to="/leases" replace />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('leases-page')).toBeInTheDocument();
  });

  it('renders the sign-in screen when unauthenticated', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } } as never);

    const App = (await import('../App')).default;
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    }, { timeout: 6000 });
  });
});

describe('Menu navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to each path when menu items are clicked', async () => {
    const { MenuBar } = await import('../components/MenuBar');

    const adminPerms = {
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

    const menuLabels: Record<string, string> = {
      leases: 'Lease Accounting',
      transactions: 'Transactions',
      modifications: 'Modifications',
      documents: 'Documents',
      reports: 'Reports',
      billing: 'Billing',
      user: 'User',
    };

    render(
      <MemoryRouter initialEntries={['/leases']}>
        <MenuBar
          onLogout={vi.fn()}
          userEmail="admin@test.com"
          userRole="admin"
          permissions={adminPerms}
          companies={[]}
          selectedCompanyId={null}
          onCompanyChange={vi.fn()}
          onCompaniesUpdated={vi.fn()}
          planKey="enterprise"
        />
        <Routes>
          <Route path="/leases" element={<div data-testid="page-leases">Leases</div>} />
          <Route path="/transactions" element={<div data-testid="page-transactions">Transactions</div>} />
          <Route path="/modifications" element={<div data-testid="page-modifications">Modifications</div>} />
          <Route path="/documents" element={<div data-testid="page-documents">Documents</div>} />
          <Route path="/reports" element={<div data-testid="page-reports">Reports</div>} />
          <Route path="/billing" element={<div data-testid="page-billing">Billing</div>} />
          <Route path="/user" element={<div data-testid="page-user">User</div>} />
        </Routes>
      </MemoryRouter>
    );

    const paths = ['transactions', 'modifications', 'documents', 'reports', 'billing', 'user', 'leases'];
    for (const path of paths) {
      const label = menuLabels[path];
      const btn = screen.getByText(label);
      btn.click();
      await waitFor(() => {
        expect(screen.getByTestId(`page-${path}`)).toBeInTheDocument();
      });
    }
  });

  it('shows Platform Admin only for the platform-owner allow-list result', async () => {
    const { MenuBar } = await import('../components/MenuBar');
    const permissions = {
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
    const props = {
      onLogout: vi.fn(),
      userEmail: 'admin@test.com',
      userRole: 'admin' as const,
      permissions,
      companies: [],
      selectedCompanyId: null,
      onCompanyChange: vi.fn(),
      onCompaniesUpdated: vi.fn(),
      planKey: 'enterprise' as const,
    };

    const { rerender } = render(
      <MemoryRouter initialEntries={['/leases']}>
        <MenuBar {...props} isPlatformAdmin={false} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Platform Admin')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={['/leases']}>
        <MenuBar {...props} isPlatformAdmin />
      </MemoryRouter>
    );
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
  });
});

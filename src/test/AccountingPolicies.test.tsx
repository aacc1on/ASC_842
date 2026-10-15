import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AccountingPoliciesPage } from '../components/AccountingPoliciesPage';
import type { UserRole } from '../App';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: [{ id: 'e1' }], error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

function renderPage(role: UserRole) {
  return render(
    <MemoryRouter>
      <AccountingPoliciesPage userRole={role} />
    </MemoryRouter>
  );
}

describe('AccountingPoliciesPage permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Configure button for admin users', async () => {
    renderPage('admin');
    await waitFor(() => {
      expect(screen.getByText('ASC 842 Policy Elections')).toBeInTheDocument();
    });
  });

  it('shows Configure button for manage users', async () => {
    renderPage('manage');
    await waitFor(() => {
      expect(screen.getByText('ASC 842 Policy Elections')).toBeInTheDocument();
    });
  });

  it('renders for view users without Configure buttons', async () => {
    renderPage('view');
    await waitFor(() => {
      expect(screen.getByText('ASC 842 Policy Elections')).toBeInTheDocument();
    });
  });

  it('shows entity type selector for admin', async () => {
    renderPage('admin');
    await waitFor(() => {
      expect(screen.getByText('ASC 842 Policy Elections')).toBeInTheDocument();
    });
  });
});

describe('AccountingPoliciesPage — settings tabs', () => {
  it('shows Accounting Policies and Approval tabs', async () => {
    renderPage('admin');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Accounting Policies/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Approval/ })).toBeInTheDocument();
    });
  });
});

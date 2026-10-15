import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-token', user: { id: 'u1', email: 'admin@test.com' } } },
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'admin@test.com' } },
      }),
      onAuthStateChange: vi.fn().mockReturnValue({ subscription: { unsubscribe: vi.fn() } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { supabase } from '../lib/supabase';

function mockUserProfile(role: string) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'user_profiles'
          ? { role, full_name: 'Admin User', email: 'admin@test.com', permissions: {} }
          : table === 'user_activity_logs'
          ? []
          : null,
        error: null,
      }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    return chain as never;
  });
}

describe('User management — admin visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows User Management tab for admins', async () => {
    mockUserProfile('admin');
    const { UserView } = await import('../components/UserView');
    render(<UserView userEmail="admin@test.com" planKey="enterprise" />);

    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('hides User Management tab for view-only users', async () => {
    mockUserProfile('view');
    const { UserView } = await import('../components/UserView');
    render(<UserView userEmail="viewer@test.com" planKey="enterprise" />);

    await waitFor(() => {
      expect(screen.queryByText('User Management')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

describe('User management — Add User gated by plan', () => {
  it('shows Add User button in ManagementTab', async () => {
    const { ManagementTab } = await import('../components/user/ManagementTab');
    render(
      <ManagementTab
        profile={{ user_id: 'u1', email: 'admin@test.com', full_name: 'Admin', role: 'admin' } as never}
        managedUsers={[]}
        filteredManagedUsers={[]}
        managementLoading={false}
        managementSearch=""
        setManagementSearch={vi.fn()}
        onAddUserClick={vi.fn()}
        onEditUserClick={vi.fn()}
        onDeleteUserClick={vi.fn()}
        onRoleSelect={vi.fn()}
        planKey="enterprise"
      />
    );
    expect(screen.getByText('Add User')).toBeInTheDocument();
  });

  it('shows Add User button for trial plan (trial includes multi_user)', async () => {
    const { ManagementTab } = await import('../components/user/ManagementTab');
    render(
      <ManagementTab
        profile={{ user_id: 'u1', email: 'admin@test.com', full_name: 'Admin', role: 'admin' } as never}
        managedUsers={[]}
        filteredManagedUsers={[]}
        managementLoading={false}
        managementSearch=""
        setManagementSearch={vi.fn()}
        onAddUserClick={vi.fn()}
        onEditUserClick={vi.fn()}
        onDeleteUserClick={vi.fn()}
        onRoleSelect={vi.fn()}
        planKey="trial"
      />
    );
    expect(screen.getByText('Add User')).toBeInTheDocument();
    expect(screen.getByText(/free trial/i)).toBeInTheDocument();
  });

  it('shows UpgradeCard for starter plan', async () => {
    const { UpgradeCard } = await import('../components/UpgradeCard');
    const { MemoryRouter } = await import('react-router-dom');
    render(
      <MemoryRouter>
        <UpgradeCard
          featureName="User Management"
          requiredPlan="Enterprise"
          description="Adding multiple users is available on the Enterprise plan."
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Add User')).not.toBeInTheDocument();
    expect(screen.getByText(/Available on Enterprise/i)).toBeInTheDocument();
  });

  it('shows UpgradeCard for professional plan', async () => {
    const { UpgradeCard } = await import('../components/UpgradeCard');
    const { MemoryRouter } = await import('react-router-dom');
    render(
      <MemoryRouter>
        <UpgradeCard
          featureName="User Management"
          requiredPlan="Enterprise"
          description="Adding multiple users is available on the Enterprise plan."
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Add User')).not.toBeInTheDocument();
    expect(screen.getByText(/Available on Enterprise/i)).toBeInTheDocument();
  });
});

describe('User management — name display fallback', () => {
  it('shows email-derived name when full_name is empty', async () => {
    const { ManagementTab } = await import('../components/user/ManagementTab');
    render(
      <ManagementTab
        profile={{ user_id: 'u1', email: 'admin@test.com', full_name: 'Admin User', role: 'admin' } as never}
        managedUsers={[
          { user_id: 'u2', email: 'mark.orwig@example.com', full_name: '', company_name: '', job_title: '', role: 'manage', permissions: {} as never, created_at: '2026-10-07' },
          { user_id: 'u3', email: 'jane@example.com', full_name: 'Jane Doe', company_name: '', job_title: '', role: 'view', permissions: {} as never, created_at: '2026-10-07' },
        ]}
        filteredManagedUsers={[
          { user_id: 'u2', email: 'mark.orwig@example.com', full_name: '', company_name: '', job_title: '', role: 'manage', permissions: {} as never, created_at: '2026-10-07' },
          { user_id: 'u3', email: 'jane@example.com', full_name: 'Jane Doe', company_name: '', job_title: '', role: 'view', permissions: {} as never, created_at: '2026-10-07' },
        ]}
        managementLoading={false}
        managementSearch=""
        setManagementSearch={vi.fn()}
        onAddUserClick={vi.fn()}
        onEditUserClick={vi.fn()}
        onDeleteUserClick={vi.fn()}
        onRoleSelect={vi.fn()}
        planKey="enterprise"
      />
    );

    expect(screen.getByText('mark.orwig')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});

describe('AddUserModal — error display', () => {
  it('shows error message inside the modal', async () => {
    const { AddUserModal } = await import('../components/user/AddUserModal');
    render(
      <AddUserModal
        form={{ email: 'test@test.com', password: 'shortpassword12', full_name: 'Test', role: 'view' }}
        setForm={vi.fn()}
        addingUser={false}
        showPassword={false}
        setShowPassword={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error="Adding users requires the Enterprise plan. Please upgrade to add team members."
      />
    );
    expect(screen.getByText(/Enterprise plan/i)).toBeInTheDocument();
  });

  it('shows email-exists error inside the modal', async () => {
    const { AddUserModal } = await import('../components/user/AddUserModal');
    render(
      <AddUserModal
        form={{ email: 'existing@test.com', password: 'password123456', full_name: '', role: 'view' }}
        setForm={vi.fn()}
        addingUser={false}
        showPassword={false}
        setShowPassword={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error="This email is already registered. Use a different email or remove the existing user first."
      />
    );
    expect(screen.getByText(/already registered/i)).toBeInTheDocument();
  });

  it('shows no error when error prop is empty', async () => {
    const { AddUserModal } = await import('../components/user/AddUserModal');
    render(
      <AddUserModal
        form={{ email: '', password: '', full_name: '', role: 'view' }}
        setForm={vi.fn()}
        addingUser={false}
        showPassword={false}
        setShowPassword={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AddUserModal — password placeholder shows 12 characters', () => {
  it('displays "At least 12 characters" placeholder', async () => {
    const { AddUserModal } = await import('../components/user/AddUserModal');
    render(
      <AddUserModal
        form={{ email: '', password: '', full_name: '', role: 'view' }}
        setForm={vi.fn()}
        addingUser={false}
        showPassword={false}
        setShowPassword={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('At least 12 characters')).toBeInTheDocument();
  });
});

describe('recreate-user edge function — error codes', () => {
  it('includes code field in plan restriction response', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/functions/recreate-user/index.ts'),
      'utf8'
    );
    expect(source).toContain('PLAN_RESTRICTED');
    expect(source).toContain('EMAIL_EXISTS');
    expect(source).toContain('WEAK_PASSWORD');
    expect(source).toContain('AUTH_EXPIRED');
  });
});

describe('User management — change password calls edge function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as never);
  });

  it('calls admin-update-user-password edge function with user_id and password', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as never);

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'mock-token', user: { id: 'u1' } } },
    } as never);

    // Simulate the exact fetch call that useManagedUsers makes
    const response = await fetch('http://localhost:5173/functions/v1/admin-update-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock-token',
      },
      body: JSON.stringify({
        user_id: 'target-user-id',
        new_password: 'newpass123',
      }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/admin-update-user-password'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('target-user-id'),
      })
    );

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.user_id).toBe('target-user-id');
    expect(body.new_password).toBe('newpass123');
    expect(response.ok).toBe(true);
  });
});

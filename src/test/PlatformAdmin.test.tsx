import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ subscription: { unsubscribe: vi.fn() } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn(),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';

function mockRpc(result: unknown) {
  vi.mocked(supabase.rpc).mockImplementation((() => {
    const builder = { order: () => builder, range: () => Promise.resolve(result) };
    return builder;
  }) as never);
}

beforeEach(() => mockRpc({ data: [], error: null }));

const mockUsers = [
  {
    user_id: 'u1',
    email: 'admin@acme.com',
    full_name: 'Alice Admin',
    role: 'admin',
    organization_id: 'org1',
    org_name: 'Acme Corp',
    plan_key: 'enterprise',
    plan_status: 'active',
    trial_ends_at: null,
    current_period_end: null,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    user_id: 'u2',
    email: 'viewer@acme.com',
    full_name: '',
    role: 'view',
    organization_id: 'org1',
    org_name: 'Acme Corp',
    plan_key: 'enterprise',
    plan_status: 'active',
    trial_ends_at: null,
    current_period_end: null,
    created_at: '2026-09-15T00:00:00Z',
  },
  {
    user_id: 'u3',
    email: 'tester@startup.com',
    full_name: 'Test User',
    role: 'admin',
    organization_id: 'org2',
    org_name: 'Startup Inc',
    plan_key: 'starter',
    plan_status: 'trialing',
    trial_ends_at: '2026-10-10T00:00:00Z',
    current_period_end: null,
    created_at: '2026-10-05T00:00:00Z',
  },
];

describe('PlatformAdminView — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the platform admin header and stats', async () => {
    mockRpc({ data: mockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);

    expect(await screen.findByText('Platform Admin')).toBeInTheDocument();
    // "3" appears in both the Total Users stat and the page footer count.
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(2);
  });

  it('renders user rows with email-derived name when full_name is empty', async () => {
    mockRpc({ data: mockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);

    expect(await screen.findByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });

  it('renders plan badges with correct labels', async () => {
    mockRpc({ data: mockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);

    await screen.findByText('Alice Admin');
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Free Trial')).toBeInTheDocument();
  });

  it('shows error message when RPC fails', async () => {
    mockRpc({ data: null, error: { message: 'Permission denied' } } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { waitFor } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    await waitFor(() => {
      expect(screen.getByText('Permission denied', { selector: 'p' })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('filters users by search query', async () => {
    mockRpc({ data: mockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { fireEvent } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    await screen.findByText('Alice Admin');
    const searchInput = screen.getByPlaceholderText(/Search by name/i);
    fireEvent.change(searchInput, { target: { value: 'Startup' } });

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
  });

  it('shows empty state when no users match search', async () => {
    mockRpc({ data: mockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { fireEvent } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    await screen.findByText('Alice Admin');
    const searchInput = screen.getByPlaceholderText(/Search by name/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistentxyz' } });

    expect(screen.getByText('No users found')).toBeInTheDocument();
  });
});

describe('PlatformAdminView — block / unblock', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const blockUsers = [
    { ...mockUsers[0], is_platform_admin: true, banned_until: null },
    { ...mockUsers[1], is_platform_admin: false, banned_until: future },
    { ...mockUsers[2], is_platform_admin: false, banned_until: past },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('isUserBlocked treats only a future ban as blocked', async () => {
    const { isUserBlocked } = await import('../components/platform-admin/platformAdminHelpers');
    expect(isUserBlocked({ banned_until: future })).toBe(true);
    expect(isUserBlocked({ banned_until: past })).toBe(false);
    expect(isUserBlocked({ banned_until: null })).toBe(false);
    expect(isUserBlocked({})).toBe(false);
  });

  it('shows a Blocked badge, Unblock for banned users and no block action for platform admins', async () => {
    mockRpc({ data: blockUsers, error: null } as never);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);

    await screen.findByText('Alice Admin');
    expect(screen.getAllByText('Blocked')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Unblock user' })).toHaveLength(1);
    // Platform admin row has no block action; the expired-ban user can be blocked.
    expect(screen.getAllByRole('button', { name: 'Block user' })).toHaveLength(1);
  });

  it('sends blocked:true to the edge function after confirmation', async () => {
    mockRpc({ data: blockUsers, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'tok' } } } as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { fireEvent, waitFor } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Block user' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/platform-admin-edit-user');
    expect(JSON.parse(init.body)).toEqual({ targetUserId: 'u3', blocked: true });
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mockRpc({ data: blockUsers, error: null } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { fireEvent } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Unblock user' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PlatformAdminView — primary admin manages platform admins', () => {
  const adminUsers = [
    { ...mockUsers[0], is_platform_admin: true, is_primary_admin: true },
    { ...mockUsers[1], is_platform_admin: true, is_primary_admin: false },
    { ...mockUsers[2], is_platform_admin: false, is_primary_admin: false },
  ];

  function mockRpcAs(primary: boolean) {
    const builder = { order: () => builder, range: () => Promise.resolve({ data: adminUsers, error: null }) };
    vi.mocked(supabase.rpc).mockImplementation(((name: string) => {
      if (name === 'is_primary_platform_admin') return Promise.resolve({ data: primary, error: null });
      if (name === 'set_platform_admin') return Promise.resolve({ data: null, error: null });
      return builder;
    }) as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Primary / Platform admin badges', async () => {
    mockRpcAs(false);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);
    await screen.findByText('Alice Admin');
    expect(screen.getByText('Primary admin')).toBeInTheDocument();
    expect(screen.getByText('Platform admin')).toBeInTheDocument();
  });

  it('hides admin management from non-primary platform admins', async () => {
    mockRpcAs(false);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    render(<PlatformAdminView />);
    await screen.findByText('Alice Admin');
    expect(screen.queryByRole('button', { name: /platform admin/i })).not.toBeInTheDocument();
  });

  it('lets the primary grant and revoke, but never on the primary row', async () => {
    mockRpcAs(true);
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { waitFor } = await import('@testing-library/react');
    render(<PlatformAdminView />);
    await screen.findByText('Alice Admin');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Make platform admin' })).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: 'Remove platform admin' })).toHaveLength(1);
  });

  it('calls set_platform_admin after confirmation', async () => {
    mockRpcAs(true);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { PlatformAdminView } = await import('../components/PlatformAdminView');
    const { fireEvent, waitFor } = await import('@testing-library/react');
    render(<PlatformAdminView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make platform admin' }));
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('set_platform_admin', { p_user_id: 'u3', p_make_admin: true }),
    );
  });
});

describe('platform admin migration — primary-only management', () => {
  it('guards set_platform_admin to the primary, protects the primary and logs changes', () => {
    const file = path.resolve(__dirname, '../../supabase/migrations/20261017120000_platform_admin_block_users.sql');
    const sql = fs.readFileSync(file, 'utf8');
    expect(sql).toMatch(/NOT internal\.is_primary_platform_admin\(\)/);
    expect(sql).toMatch(/primary platform administrator cannot be removed/);
    expect(sql).toMatch(/p_user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/INSERT INTO internal\.platform_admin_events/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_platform_admin\(uuid, boolean\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/platform_admins_single_primary/);
  });
});

describe('get_all_users_with_plans RPC — migration exists', () => {
  it('the migration file exists with SECURITY DEFINER', () => {
    const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationsDir);
    const migrationFile = files.find(f => f.includes('get_all_users_with_plans'));
    expect(migrationFile).toBeDefined();
    const content = fs.readFileSync(path.join(migrationsDir, migrationFile!), 'utf8');
    expect(content).toContain('SECURITY DEFINER');
    expect(content).toContain('get_all_users_with_plans');
  });
});

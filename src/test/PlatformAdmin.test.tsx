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

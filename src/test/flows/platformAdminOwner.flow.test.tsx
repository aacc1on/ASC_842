/**
 * Flow test (h): Platform Admin is available only to the platform owner.
 *
 * Renders the REAL App shell (App.tsx → MenuBar, routing, lazy PlatformAdminView,
 * DataHealthPanel, ErrorAlertsPanel) on top of the in-memory Supabase fake.
 *
 * Ownership is decided solely by the server-side `is_platform_admin` RPC
 * (internal.platform_admins table). App.tsx treats only `data === true` as
 * owner, and registers the `/admin` route only for owners; anything else falls
 * through to the `*` route which redirects to `/leases`. Org role, email and
 * user_metadata play no part in the decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeSupabase, RpcError } from '../fixtures/fakeSupabase';
import type { Row, Tables } from '../fixtures/goldenPortfolio';
import type { MyPlan } from '../../utils/planFeatures';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }),
}));

const OWNER_ID = '768308c8-0b63-4f1a-aed1-d7deeb00aa31';
const OWNER_EMAIL = 'minas.sahakyan@yahoo.com';
const ORG_ADMIN_ID = 'user-org-admin-1';
const ORG_ADMIN_EMAIL = 'orgadmin@acme.com';
const FIND = { timeout: 10000 };

type Fake = ReturnType<typeof createFakeSupabase>;
let fake: Fake;
let invokeCalls: string[];

const ENTERPRISE: MyPlan = {
  plan_key: 'enterprise',
  status: 'active',
  trial_ends_at: null,
  days_left: null,
  features: { contract_modifications: true, branches: true, multi_user: true },
};

const PLATFORM_USERS = [
  {
    user_id: 'u1', email: 'alice@acme.com', full_name: 'Alice Admin', role: 'admin',
    organization_id: 'org1', org_name: 'Acme Corp', plan_key: 'enterprise', plan_status: 'active',
    trial_ends_at: null, current_period_end: null, created_at: '2026-01-05T00:00:00Z',
  },
  {
    user_id: 'u2', email: 'bob@globex.com', full_name: '', role: 'view',
    organization_id: 'org2', org_name: 'Globex Ltd', plan_key: 'trial', plan_status: 'trialing',
    trial_ends_at: '2026-03-01T00:00:00Z', current_period_end: null, created_at: '2026-01-06T00:00:00Z',
  },
  {
    user_id: 'u3', email: 'carol@initech.com', full_name: 'Carol Manager', role: 'manage',
    organization_id: 'org3', org_name: 'Initech', plan_key: 'professional', plan_status: 'active',
    trial_ends_at: null, current_period_end: null, created_at: '2026-01-07T00:00:00Z',
  },
];

const ALERTS = [
  {
    id: 1, created_at: '2026-02-01T10:00:00Z', reason: 'critical', error_count: 1,
    sample_message: 'Month-end close failed for org Acme', sample_source: 'month_end', sample_route: '/leases',
    suppressed_count: 0, delivery_status: 'sent', delivered_at: '2026-02-01T10:00:05Z', delivery_error: null,
  },
  {
    id: 2, created_at: '2026-02-02T11:00:00Z', reason: 'threshold', error_count: 14,
    sample_message: 'Spike of client errors', sample_source: null, sample_route: '/reports',
    suppressed_count: 3, delivery_status: 'not_configured', delivered_at: null, delivery_error: null,
  },
];

const EXTRA_BUILDERS = ['or', 'ilike', 'like', 'match', 'contains', 'overlaps', 'filter', 'textSearch', 'csv', 'abortSignal'];

/** Adds builder methods the fixture lacks (or, ilike, …) as no-op pass-throughs (this test worker only). */
function tolerant<T extends object>(q: T): T {
  const proto = Object.getPrototypeOf(q) as Record<string, unknown>;
  for (const m of EXTRA_BUILDERS) {
    if (!(m in proto)) proto[m] = function passThrough(this: unknown) { return this; };
  }
  return q;
}

function seed(userId: string, email: string): Tables {
  const profile: Row = {
    id: `profile-${userId}`,
    user_id: userId,
    email,
    full_name: 'Signed In User',
    role: 'admin',
    permissions: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  return {
    user_profiles: [profile],
    companies: [{ id: 'co-1', company_name: 'Acme Holdings', company_code: 'ACME', is_active: true }],
    leases: [],
    branches: [],
    contract_modifications: [],
    amortization_schedules: [],
  } as unknown as Tables;
}

type OwnerAnswer = unknown | 'error' | 'hang';

interface MountOpts {
  userId?: string;
  email?: string;
  isOwner: OwnerAnswer;
  path?: string;
  userMetadata?: Record<string, unknown>;
  usersError?: string;
  alertsError?: string;
}

function mount(o: MountOpts) {
  const userId = o.userId ?? ORG_ADMIN_ID;
  const email = o.email ?? ORG_ADMIN_EMAIL;
  invokeCalls = [];
  fake = createFakeSupabase(seed(userId, email), {
    userId,
    email,
    rpc: {
      get_my_plan: () => ENTERPRISE,
      is_platform_admin: () => {
        if (o.isOwner === 'error') throw new RpcError('permission denied for function is_platform_admin', '42501');
        return o.isOwner;
      },
      get_all_users_with_plans: () => {
        if (o.usersError) throw new RpcError(o.usersError, 'P0001');
        return PLATFORM_USERS;
      },
      get_platform_data_health: () => [],
      get_error_alerts: () => {
        if (o.alertsError) throw new RpcError(o.alertsError);
        return ALERTS;
      },
      get_error_alert_settings: () => [{ threshold: 10, window_minutes: 15, debounce_minutes: 30 }],
      get_pending_approvals: () => [],
    },
  });
  const baseFrom = fake.from;
  const baseRpc = fake.rpc;
  const noopChannel = { on: () => noopChannel, subscribe: () => noopChannel, unsubscribe: () => undefined };
  const session = { user: { id: userId, email, user_metadata: o.userMetadata ?? {}, app_metadata: {} }, access_token: 'test-token' };
  h.client = {
    ...fake,
    from: (t: string) => tolerant(baseFrom(t)),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'is_platform_admin' && o.isOwner === 'hang') {
        fake.calls.push({ fn, args });
        return new Promise(() => undefined);
      }
      return baseRpc(fn, args);
    },
    auth: {
      ...fake.auth,
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    channel: () => noopChannel,
    removeChannel: () => undefined,
    functions: {
      invoke: (name: string) => {
        invokeCalls.push(name);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
  window.history.pushState({}, '', o.path ?? '/leases');
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const sidebar = () => screen.getAllByRole('navigation', { name: 'Main navigation' })[0];
const menuButton = (label: string) =>
  within(sidebar()).queryAllByRole('button').find((b) => b.textContent?.trim() === label) ?? null;

/** Waits until the shell has resolved role, plan, companies and owner status and the Dashboard is rendered. */
async function waitForDashboardLoaded() {
  await screen.findByText('No leases yet', undefined, FIND);
  await waitFor(() => expect(within(sidebar()).getByText('Admin')).toBeInTheDocument(), FIND);
  await waitFor(() => expect(fake.calls.some((c) => c.fn === 'is_platform_admin')).toBe(true), FIND);
}

const rpcCalled = (fn: string) => fake.calls.some((c) => c.fn === fn);

async function expectDeniedAtLeases() {
  await waitFor(() => expect(window.location.pathname).toBe('/leases'), FIND);
  await waitForDashboardLoaded();
  expect(menuButton('Platform Admin')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Platform Admin' })).not.toBeInTheDocument();
  expect(screen.queryByText('Error alerts')).not.toBeInTheDocument();
  expect(rpcCalled('get_all_users_with_plans')).toBe(false);
  expect(rpcCalled('get_error_alerts')).toBe(false);
  expect(rpcCalled('get_platform_data_health')).toBe(false);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('platform admin is owner-only (flow)', { timeout: 30000 }, () => {
  it('owner: menu shows Platform Admin → view loads users list, stats, data health and error alerts', async () => {
    const user = mount({ userId: OWNER_ID, email: OWNER_EMAIL, isOwner: true });
    await waitForDashboardLoaded();

    const item = await waitFor(() => {
      const b = menuButton('Platform Admin');
      expect(b).not.toBeNull();
      return b!;
    }, FIND);
    await user.click(item);
    expect(window.location.pathname).toBe('/admin');

    expect(await screen.findByRole('heading', { name: 'Platform Admin' }, FIND)).toBeInTheDocument();

    // Users list
    const alice = await screen.findByText('Alice Admin', undefined, FIND);
    const table = alice.closest('table')!;
    expect(within(table).getByText('alice@acme.com')).toBeInTheDocument();
    expect(within(table).getByText('bob')).toBeInTheDocument(); // empty full_name → email local part
    expect(within(table).getByText('Globex Ltd')).toBeInTheDocument();
    expect(within(table).getByText('Carol Manager')).toBeInTheDocument();
    expect(within(table).getAllByTitle('Edit user')).toHaveLength(3);
    expect(screen.getByText('3 of 3 users match across 3 organizations')).toBeInTheDocument();

    // Search narrows the list
    await user.type(screen.getByPlaceholderText(/Search by name, email/), 'globex');
    await waitFor(() => expect(screen.getByText('1 of 3 users match across 3 organizations')).toBeInTheDocument());
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(/Search by name, email/));

    // Data health + error alerts panels
    expect(await screen.findByText('Data health (all organizations)', undefined, FIND)).toBeInTheDocument();
    expect(await screen.findByText('Error alerts', undefined, FIND)).toBeInTheDocument();
    const msg = await screen.findByText('Month-end close failed for org Acme', undefined, FIND);
    const alertsTable = msg.closest('table')!;
    expect(within(alertsTable).getByText('Critical')).toBeInTheDocument();
    expect(within(alertsTable).getByText('Error spike')).toBeInTheDocument();
    expect(within(alertsTable).getByText('Month-end')).toBeInTheDocument();
    expect(within(alertsTable).getByText('+3 while paused')).toBeInTheDocument();
    expect(within(alertsTable).getByText('No alert destination set')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();

    expect(rpcCalled('get_all_users_with_plans')).toBe(true);
    expect(rpcCalled('get_platform_data_health')).toBe(true);
    expect(fake.calls.find((c) => c.fn === 'get_error_alerts')?.args).toEqual({ p_limit: 50 });
  });

  it('owner: deep link to /admin renders the view directly (no redirect)', async () => {
    mount({ userId: OWNER_ID, email: OWNER_EMAIL, isOwner: true, path: '/admin' });
    expect(await screen.findByRole('heading', { name: 'Platform Admin' }, FIND)).toBeInTheDocument();
    expect(await screen.findByText('Alice Admin', undefined, FIND)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin');
    expect(menuButton('Platform Admin')).not.toBeNull();
  });

  it('owner: users RPC and alerts RPC failures surface inside the view without crashing it', async () => {
    mount({
      userId: OWNER_ID, email: OWNER_EMAIL, isOwner: true, path: '/admin',
      usersError: 'Platform administrator access required', alertsError: 'boom',
    });
    expect(await screen.findByRole('heading', { name: 'Platform Admin' }, FIND)).toBeInTheDocument();
    expect(await screen.findByText('Platform administrator access required', undefined, FIND)).toBeInTheDocument();
    expect(await screen.findByText('No users found', undefined, FIND)).toBeInTheDocument();
    expect(await screen.findByText(/Could not load error alerts|boom/, undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText('Month-end close failed for org Acme')).not.toBeInTheDocument();
  });

  it('regular org admin: no Platform Admin menu item even though every org-admin menu item is shown', async () => {
    mount({ isOwner: false });
    await waitForDashboardLoaded();
    expect(menuButton('Settings')).not.toBeNull();
    expect(menuButton('Modifications')).not.toBeNull();
    expect(menuButton('User')).not.toBeNull();
    expect(menuButton('Platform Admin')).toBeNull();
    expect(within(sidebar()).queryByText('Platform Admin')).not.toBeInTheDocument();
    expect(rpcCalled('get_all_users_with_plans')).toBe(false);
  });

  it('regular org admin: deep link to /admin is redirected to /leases and no admin RPCs are called', async () => {
    mount({ isOwner: false, path: '/admin' });
    await expectDeniedAtLeases();
  });

  it('owner-check RPC error fails closed: no menu, /admin redirected', async () => {
    mount({ userId: OWNER_ID, email: OWNER_EMAIL, isOwner: 'error', path: '/admin' });
    await expectDeniedAtLeases();
  });

  it.each([
    ['string "true"', 'true'],
    ['number 1', 1],
    ['object {is_admin:true}', { is_admin: true }],
    ['array [true]', [true]],
    ['null', null],
  ])('truthy-but-not-true / null owner-check result (%s) is not treated as owner', async (_label, answer) => {
    mount({ isOwner: answer, path: '/admin' });
    await expectDeniedAtLeases();
  });

  it('non-owner with spoofed owner email and user_metadata (is_platform_admin/role) is still denied', async () => {
    const user = mount({
      userId: 'attacker-1',
      email: OWNER_EMAIL,
      isOwner: false,
      path: '/admin',
      userMetadata: { is_platform_admin: true, platform_admin: true, role: 'platform_admin' },
    });
    await expectDeniedAtLeases();
    // Navigating around via the menu never exposes it either.
    await user.click(menuButton('User')!);
    expect(window.location.pathname).toBe('/user');
    expect(menuButton('Platform Admin')).toBeNull();
    expect(invokeCalls.some((n) => n.startsWith('platform-admin'))).toBe(false);
  });

  it('owner-check that never settles never grants access (menu hidden, routes held behind the loader)', async () => {
    mount({ userId: OWNER_ID, email: OWNER_EMAIL, isOwner: 'hang', path: '/admin' });
    await screen.findByText('Lease Accounting', undefined, FIND);
    await waitFor(() => expect(rpcCalled('is_platform_admin')).toBe(true), FIND);
    await waitFor(() => expect(within(sidebar()).getByText('Admin')).toBeInTheDocument(), FIND);
    expect(menuButton('Platform Admin')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Platform Admin' })).not.toBeInTheDocument();
    // App gates ALL routes on platformAdminLoaded, so even the Dashboard never renders.
    expect(screen.queryByText('No leases yet')).not.toBeInTheDocument();
    expect(rpcCalled('get_all_users_with_plans')).toBe(false);
  });
});

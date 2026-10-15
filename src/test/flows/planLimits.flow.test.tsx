/**
 * Flow test (g): plan limits — starter vs enterprise vs expired (plus trial,
 * past-due and RPC-failure edge cases).
 *
 * Renders the REAL App shell (App.tsx → MenuBar, Dashboard, UserView,
 * ModificationsModule, BillingView …) with BrowserRouter on top of the
 * in-memory Supabase fake and navigates via clicks. The plan comes from the
 * `get_my_plan` RPC (src/utils/planFeatures.ts → fetchMyPlan).
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

const USER_ID = 'user-plan-1';
const EMAIL = 'owner@example.com';
const FIND = { timeout: 10000 };

type Fake = ReturnType<typeof createFakeSupabase>;
let fake: Fake;
let tables: Tables;

const plan = (over: Partial<MyPlan>): MyPlan => ({
  plan_key: 'starter',
  status: 'active',
  trial_ends_at: null,
  days_left: null,
  features: { contract_modifications: false, branches: false, multi_user: false },
  ...over,
});

const STARTER = plan({});
const ENTERPRISE = plan({
  plan_key: 'enterprise',
  features: { contract_modifications: true, branches: true, multi_user: true },
});
const EXPIRED = plan({ plan_key: 'expired', status: 'cancelled' });
const EXPIRED_TRIAL = plan({ plan_key: 'expired', status: 'expired', trial_ends_at: '2026-01-01T00:00:00Z', days_left: 0 });
const TRIAL = plan({
  plan_key: 'trial',
  status: 'trial',
  trial_ends_at: '2099-01-01T00:00:00Z',
  days_left: 9,
  features: { contract_modifications: true, branches: true, multi_user: true },
});
const PAST_DUE = plan({
  plan_key: 'professional',
  status: 'past_due',
  days_left: 3,
  features: { contract_modifications: true, branches: true, multi_user: false },
});

const EXTRA_BUILDERS = ['or', 'ilike', 'like', 'match', 'contains', 'overlaps', 'filter', 'textSearch', 'csv', 'abortSignal'];

/** Adds builder methods the fixture lacks (or, ilike, …) as no-op pass-throughs (this test worker only). */
function tolerant<T extends object>(q: T): T {
  const proto = Object.getPrototypeOf(q) as Record<string, unknown>;
  for (const m of EXTRA_BUILDERS) {
    if (!(m in proto)) proto[m] = function passThrough(this: unknown) { return this; };
  }
  return q;
}

function seed(): Tables {
  const profile: Row = {
    id: 'profile-1',
    user_id: USER_ID,
    email: EMAIL,
    full_name: 'Plan Owner',
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

function mount(myPlan: MyPlan | 'error', path = '/leases') {
  tables = seed();
  fake = createFakeSupabase(tables, {
    userId: USER_ID,
    email: EMAIL,
    rpc: {
      get_my_plan: () => {
        if (myPlan === 'error') throw new RpcError('boom');
        return myPlan;
      },
      is_platform_admin: () => false,
    },
  });
  const baseFrom = fake.from;
  const noopChannel = { on: () => noopChannel, subscribe: () => noopChannel, unsubscribe: () => undefined };
  h.client = {
    ...fake,
    from: (t: string) => tolerant(baseFrom(t)),
    auth: { ...fake.auth, signOut: () => Promise.resolve({ error: null }) },
    channel: () => noopChannel,
    removeChannel: () => undefined,
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };
  window.history.pushState({}, '', path);
  const user = userEvent.setup();
  render(<App />);
  return user;
}

const sidebar = () => screen.getAllByRole('navigation', { name: 'Main navigation' })[0];
const menuButton = (label: string) =>
  within(sidebar()).queryAllByRole('button').find((b) => b.textContent?.trim() === label) ?? null;

async function waitForShell() {
  await screen.findByText('Lease Accounting', undefined, FIND);
}

/** Waits for the real Dashboard to finish its lease query, and for the admin role to be applied. */
async function waitForDashboardLoaded() {
  await screen.findByText('No leases yet', undefined, FIND);
  await waitFor(() => expect(within(sidebar()).getByText('Admin')).toBeInTheDocument(), FIND);
}

async function openUserManagement(user: ReturnType<typeof userEvent.setup>) {
  await user.click(menuButton('User')!);
  const tab = await screen.findByRole('button', { name: /User Management/ }, FIND);
  await user.click(tab);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('plan limits flow', { timeout: 30000 }, () => {
  it('starter: Modifications is hidden from the menu and the direct route shows the Professional upgrade card that links to billing', async () => {
    const user = mount(STARTER, '/modifications');
    expect(await screen.findByText('Available on Professional', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/Contract modifications, cancellations, and lease impairments/)).toBeInTheDocument();
    expect(menuButton('Modifications')).toBeNull();
    // Active plan: no inactive banner, writes allowed.
    expect(screen.queryByText('Your subscription is inactive')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upgrade to Professional/ }));
    expect(window.location.pathname).toBe('/billing');
    expect(fake.calls.some((c) => c.fn === 'get_my_plan')).toBe(true);
  });

  it('starter: User Management (multi_user) shows the Enterprise upgrade card instead of the Add User control', async () => {
    const user = mount(STARTER);
    await waitForShell();
    // Lease creation is still allowed on an active starter plan.
    expect(await screen.findByRole('button', { name: /New Lease/ }, FIND)).toBeInTheDocument();

    await openUserManagement(user);
    expect(await screen.findByText('Available on Enterprise', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/Adding multiple users with team roles is available on the Enterprise plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upgrade to Enterprise/ }));
    expect(window.location.pathname).toBe('/billing');
  });

  it('enterprise: Modifications and User Management are available without any upgrade card', async () => {
    const user = mount(ENTERPRISE);
    await waitForShell();
    expect(await screen.findByRole('button', { name: /New Lease/ }, FIND)).toBeInTheDocument();

    const mods = menuButton('Modifications');
    expect(mods).not.toBeNull();
    await user.click(mods!);
    expect(window.location.pathname).toBe('/modifications');
    expect(await screen.findByRole('heading', { name: 'Contract Modifications' }, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/^Available on /)).not.toBeInTheDocument();

    await openUserManagement(user);
    expect(await screen.findByRole('button', { name: /Add User/ }, FIND)).toBeInTheDocument();
    expect(screen.queryByText('Available on Enterprise')).not.toBeInTheDocument();
  });

  it('expired subscription: inactive banner, read-only lease list, gated features hidden, Go to Billing navigates', async () => {
    const user = mount(EXPIRED);
    expect(await screen.findByText('Your subscription is inactive', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/creating, editing, or deleting is disabled until you subscribe/)).toBeInTheDocument();
    expect(screen.queryByText('Your free trial has ended')).not.toBeInTheDocument();

    // The user IS an admin, but Dashboard receives VIEW permissions → no "New Lease".
    await waitForDashboardLoaded();
    expect(screen.queryByRole('button', { name: /New Lease/ })).not.toBeInTheDocument();
    expect(menuButton('Modifications')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Go to Billing/ }));
    expect(window.location.pathname).toBe('/billing');
    // Banner persists across routes while expired.
    expect(screen.getByText('Your subscription is inactive')).toBeInTheDocument();
  });

  it('expired subscription: gated routes (modifications, user management) still show upgrade cards', async () => {
    const user = mount(EXPIRED, '/modifications');
    expect(await screen.findByText('Available on Professional', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText('Your subscription is inactive')).toBeInTheDocument();
    await openUserManagement(user);
    expect(await screen.findByText('Available on Enterprise', undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();
  });

  it('expired subscription: menu company dropdown still offers "Add Company" (MenuBar gets un-downgraded permissions)', async () => {
    const user = mount(EXPIRED);
    await screen.findByText('Your subscription is inactive', undefined, FIND);
    await user.click(within(sidebar()).getByRole('button', { name: 'Select company' }));
    // Observed product behaviour: App passes raw userPermissions (not effectivePermissions)
    // to MenuBar, so the write action remains reachable in read-only mode.
    const addCompany = within(sidebar()).queryByRole('button', { name: /Add Company/ });
    expect(addCompany).not.toBeNull();
  });

  it('expired trial: banner says the free trial has ended and creation is disabled', async () => {
    mount(EXPIRED_TRIAL);
    expect(await screen.findByText('Your free trial has ended', undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText('Your subscription is inactive')).not.toBeInTheDocument();
    await waitForDashboardLoaded();
    expect(screen.queryByRole('button', { name: /New Lease/ })).not.toBeInTheDocument();
  });

  it('active trial: every gated feature is unlocked and no subscription banner is shown', async () => {
    const user = mount(TRIAL);
    await waitForShell();
    expect(await screen.findByRole('button', { name: /New Lease/ }, FIND)).toBeInTheDocument();
    expect(screen.queryByText('Your subscription is inactive')).not.toBeInTheDocument();
    expect(screen.queryByText('Your free trial has ended')).not.toBeInTheDocument();
    expect(menuButton('Modifications')).not.toBeNull();

    await openUserManagement(user);
    expect(await screen.findByRole('button', { name: /Add User/ }, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/^Available on /)).not.toBeInTheDocument();
  });

  it('past-due professional: grace-period banner, writes still allowed, multi_user still gated', async () => {
    const user = mount(PAST_DUE);
    expect(await screen.findByText(/Payment failed — update billing within 3 days/, undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText('Your subscription is inactive')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /New Lease/ }, FIND)).toBeInTheDocument();
    expect(menuButton('Modifications')).not.toBeNull();

    await openUserManagement(user);
    expect(await screen.findByText('Available on Enterprise', undefined, FIND)).toBeInTheDocument();
  });

  it('get_my_plan RPC failure falls back to expired (read-only) mode', async () => {
    mount('error');
    expect(await screen.findByText('Your subscription is inactive', undefined, FIND)).toBeInTheDocument();
    await waitForDashboardLoaded();
    expect(screen.queryByRole('button', { name: /New Lease/ })).not.toBeInTheDocument();
    expect(menuButton('Modifications')).toBeNull();
  });
});

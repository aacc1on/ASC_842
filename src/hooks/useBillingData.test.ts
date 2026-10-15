import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useBillingData } from './useBillingData';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

let tables: Tables;

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  const fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
  return fake;
}

const plan = (over: Record<string, unknown>) => ({
  id: 'p', plan_key: 'k', plan_name: 'P', max_leases: 10, price_monthly: 1, price_annually: 10,
  features: [], is_active: true, sort_order: 1, stripe_price_id_monthly: null, stripe_price_id_annually: null, ...over,
});

beforeEach(() => {
  tables = {
    subscription_plans: [
      plan({ id: 'ent', plan_key: 'enterprise', sort_order: 3, features: '["sso","users"]' }),
      plan({ id: 'starter', plan_key: 'starter', sort_order: 1, features: ['reports'] }),
      plan({ id: 'legacy', plan_key: 'legacy', sort_order: 0, is_active: false }),
      plan({ id: 'pro', plan_key: 'professional', sort_order: 2, features: [] }),
    ],
    subscriptions: [
      { id: 's1', plan_key: 'professional', billing_cycle: 'annually', status: 'trialing', trial_ends_at: '2025-01-01', current_period_start: '2024-12-01', current_period_end: '2025-01-01' },
    ],
    stripe_user_subscriptions: [
      { customer_id: 'cus_1', subscription_id: 'sub_1', subscription_status: 'active', price_id: 'price_1', current_period_start: 1, current_period_end: 2, cancel_at_period_end: false, payment_method_brand: 'visa', payment_method_last4: '4242' },
    ],
    stripe_org_subscriptions: [
      { customer_id: 'cus_1', subscription_id: 'sub_1', subscription_status: 'active', price_id: 'price_1', current_period_start: 1, current_period_end: 2, cancel_at_period_end: false, payment_method_brand: 'visa', payment_method_last4: '4242' },
    ],
    stripe_org_invoices: [],
    stripe_user_orders: [
      ...Array.from({ length: 22 }, (_, i) => ({ order_id: i + 1, checkout_session_id: `cs_${i}`, amount_total: 100, currency: 'usd', payment_status: 'paid', order_status: 'completed', order_date: `2024-01-${String(i + 1).padStart(2, '0')}` })),
      { order_id: null, checkout_session_id: 'cs_null', order_date: '2024-12-31' },
    ],
  };
  setup();
});

describe('useBillingData', () => {
  it('starts loading then loads everything on mount', async () => {
    const { result } = renderHook(() => useBillingData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();

    // only active plans, sorted, features parsed from JSON strings
    expect(result.current.plans.map((p) => p.id)).toEqual(['starter', 'pro', 'ent']);
    expect(result.current.plans[2].features).toEqual(['sso', 'users']);
    expect(result.current.plans[0].features).toEqual(['reports']);

    expect(result.current.currentSubscription).toMatchObject({ plan_key: 'professional', status: 'trialing', billing_cycle: 'annually', trial_ends_at: '2025-01-01' });
    expect(result.current.stripeSubscription).toMatchObject({ customer_id: 'cus_1', payment_method_last4: '4242' });

    // newest first, limit 20, then rows without order_id dropped (so 19 here)
    expect(result.current.orders[0].order_id).toBe(22);
    expect(result.current.orders).toHaveLength(19);
    expect(result.current.orders.every((o) => o.order_id != null)).toBe(true);
  });

  it('handles empty data (no subscription, no stripe customer, no orders)', async () => {
    tables = { subscription_plans: [], subscriptions: [], stripe_user_subscriptions: [{ customer_id: null }], stripe_org_subscriptions: [{ customer_id: null }], stripe_org_invoices: [], stripe_user_orders: [] };
    setup();
    const { result } = renderHook(() => useBillingData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toEqual([]);
    expect(result.current.currentSubscription).toBeNull();
    expect(result.current.stripeSubscription).toBeNull();
    expect(result.current.orders).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('a failed query shows an error instead of an empty billing page, and loading ends', async () => {
    setup({ failures: { select: { subscriptions: 'x' } } });
    const { result } = renderHook(() => useBillingData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load billing information.');
    expect(result.current.plans).toEqual([]);
  });

  it('ignores a stale response after unmount', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const fake = setup();
    const from = fake.from;
    h.client = { ...fake, from: (t: string) => { const q = from(t); const then = q.then.bind(q); return Object.assign(q, { then: (a: never, b: never) => gate.then(() => then(a, b)) }); } };
    const { result, unmount } = renderHook(() => useBillingData());
    const before = result.current;
    unmount();
    await act(async () => { release(); await gate; });
    expect(result.current).toBe(before);
  });

  it('sets an error when plan features are malformed JSON', async () => {
    tables.subscription_plans = [plan({ features: 'not json' })];
    const { result } = renderHook(() => useBillingData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load billing information.');
  });

  it('reload re-fetches and clears a previous error', async () => {
    tables.subscription_plans = [plan({ features: '{' })];
    const { result } = renderHook(() => useBillingData());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    tables.subscription_plans = [plan({ id: 'fixed', features: [] })];
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBeNull();
    expect(result.current.plans.map((p) => p.id)).toEqual(['fixed']);
  });

  it('getSessionToken returns the access token or null when signed out', async () => {
    const { result } = renderHook(() => useBillingData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.getSessionToken()).resolves.toBe('test-token');
    setup({ signedOut: true });
    await expect(result.current.getSessionToken()).resolves.toBeNull();
  });
});

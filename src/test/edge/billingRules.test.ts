import { describe, it, expect } from 'vitest';
import {
  allPriceIds, maskId, pickPrimarySubscription, planForPrice, planLimitBlockers, priceForPlan, toOrgStatus,
  type PlanRow,
} from '../../../supabase/functions/_shared/billingRules';
import { RATE_LIMITS } from '../../../supabase/functions/_shared/rateLimit';

const plans: PlanRow[] = [
  { plan_key: 'starter', plan_name: 'Starter', max_leases: 50, max_users: 1, stripe_price_id_monthly: 'price_sm', stripe_price_id_annually: 'price_sa' },
  { plan_key: 'professional', plan_name: 'Professional', max_leases: 100, max_users: 1, stripe_price_id_monthly: 'price_pm', stripe_price_id_annually: 'price_pa' },
  { plan_key: 'enterprise', plan_name: 'Enterprise', max_leases: 200, max_users: 10, stripe_price_id_monthly: 'price_em', stripe_price_id_annually: 'price_ea' },
];

describe('pickPrimarySubscription', () => {
  it('prefers a renewing live subscription over a newer cancelled one', () => {
    const renewing = { id: 'a', status: 'active', cancel_at_period_end: false, current_period_end: 100, created: 1 };
    const cancelled = { id: 'b', status: 'canceled', cancel_at_period_end: false, current_period_end: 900, created: 9 };
    expect(pickPrimarySubscription([cancelled, renewing])?.id).toBe('a');
  });

  it('prefers renewing over cancelling, then the later period end', () => {
    const cancelling = { id: 'a', status: 'active', cancel_at_period_end: true, current_period_end: 900 };
    const renewingEarly = { id: 'b', status: 'active', cancel_at_period_end: false, current_period_end: 100 };
    const renewingLate = { id: 'c', status: 'trialing', cancel_at_period_end: false, current_period_end: 200 };
    expect(pickPrimarySubscription([cancelling, renewingEarly, renewingLate])?.id).toBe('c');
  });

  it('is order-independent and returns null for none', () => {
    const subs = [
      { id: 'm', status: 'active', cancel_at_period_end: false, current_period_end: 100 },
      { id: 'y', status: 'active', cancel_at_period_end: false, current_period_end: 500 },
    ];
    expect(pickPrimarySubscription(subs)?.id).toBe('y');
    expect(pickPrimarySubscription([...subs].reverse())?.id).toBe('y');
    expect(pickPrimarySubscription([])).toBeNull();
  });
});

describe('plan and price mapping', () => {
  it('maps every price to its plan and cycle', () => {
    expect(planForPrice(plans, 'price_pa')).toEqual({ plan: plans[1], cycle: 'annually' });
    expect(planForPrice(plans, 'price_em')?.cycle).toBe('monthly');
    expect(planForPrice(plans, 'price_unknown')).toBeNull();
    expect(planForPrice(plans, null)).toBeNull();
    expect(priceForPlan(plans[0], 'annually')).toBe('price_sa');
    expect(allPriceIds(plans)).toHaveLength(6);
  });

  it('maps Stripe statuses to organization statuses', () => {
    expect(toOrgStatus('active')).toBe('active');
    expect(toOrgStatus('past_due')).toBe('past_due');
    expect(toOrgStatus('canceled')).toBe('cancelled');
    expect(toOrgStatus('something_new')).toBe('cancelled');
  });
});

describe('planLimitBlockers', () => {
  it('allows a switch within limits', () => {
    expect(planLimitBlockers({ activeLeases: 50, users: 1 }, plans[0])).toEqual([]);
  });

  it('blocks a downgrade that exceeds leases or users', () => {
    const reasons = planLimitBlockers({ activeLeases: 120, users: 3 }, plans[1]);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/120 active leases.*allows 100.*20 leases/);
    expect(reasons[1]).toMatch(/3 users.*allows 1.*2 users/);
  });
});

describe('maskId and rate limits', () => {
  it('masks ids down to prefix and last four', () => {
    expect(maskId('cus_ABCDEFGH1234')).toBe('cus_...1234');
    expect(maskId(null)).toBeNull();
  });

  it('rate-limits plan changes and billing sync', () => {
    expect(RATE_LIMITS['stripe-change-plan']).toEqual({ limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMITS['stripe-billing-sync']).toEqual({ limit: 60, windowSeconds: 3600 });
  });
});

import Stripe from 'npm:stripe@17.7.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.1';
import {
  allPriceIds, BILLABLE_STATUSES, pickPrimarySubscription, planForPrice, toOrgStatus, type PlanRow,
} from './billingRules.ts';

export interface OrgCustomer { customer_id: string; user_id: string }

export function stripeClient(): Stripe | null {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  return key ? new Stripe(key, { appInfo: { name: 'Bolt Integration', version: '1.0.0' } }) : null;
}

export async function loadPlans(admin: SupabaseClient): Promise<PlanRow[]> {
  const { data, error } = await admin
    .from('subscription_plans')
    .select('plan_key, plan_name, max_leases, max_users, stripe_price_id_monthly, stripe_price_id_annually')
    .eq('is_active', true);
  if (error) throw new Error(`Failed to load plans: ${error.message}`);
  return (data ?? []) as PlanRow[];
}

/** Stripe customers belonging to any user in the organization, newest first. */
export async function orgCustomers(admin: SupabaseClient, orgId: string): Promise<OrgCustomer[]> {
  const { data: users, error: usersError } = await admin
    .from('user_profiles').select('user_id').eq('organization_id', orgId);
  if (usersError) throw new Error(`Failed to load organization users: ${usersError.message}`);
  const userIds = (users ?? []).map((u: { user_id: string }) => u.user_id);
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from('stripe_customers')
    .select('customer_id, user_id')
    .in('user_id', userIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load Stripe customers: ${error.message}`);
  return (data ?? []) as OrgCustomer[];
}

export async function orgIdForCustomer(admin: SupabaseClient, customerId: string): Promise<string | null> {
  const { data: customer } = await admin
    .from('stripe_customers').select('user_id').eq('customer_id', customerId).is('deleted_at', null).maybeSingle();
  if (!customer?.user_id) return null;
  const { data: profile } = await admin
    .from('user_profiles').select('organization_id').eq('user_id', customer.user_id).maybeSingle();
  return profile?.organization_id ?? null;
}

export interface OrgStripeState {
  customers: OrgCustomer[];
  byCustomer: Map<string, Stripe.Subscription[]>;
  primary: Stripe.Subscription | null;
  primaryCustomer: OrgCustomer | null;
}

export async function loadOrgStripeState(stripe: Stripe, admin: SupabaseClient, orgId: string): Promise<OrgStripeState> {
  const customers = await orgCustomers(admin, orgId);
  const byCustomer = new Map<string, Stripe.Subscription[]>();
  for (const c of customers) {
    const list = await stripe.subscriptions.list({
      customer: c.customer_id, status: 'all', limit: 20, expand: ['data.default_payment_method'],
    });
    byCustomer.set(c.customer_id, list.data);
  }
  const primary = pickPrimarySubscription([...byCustomer.values()].flat());
  const primaryCustomer = primary
    ? customers.find((c) => c.customer_id === (typeof primary.customer === 'string' ? primary.customer : primary.customer.id)) ?? null
    : null;
  return { customers, byCustomer, primary, primaryCustomer };
}

export function billableSubscriptions(state: OrgStripeState): Stripe.Subscription[] {
  return [...state.byCustomer.values()].flat().filter((s) => BILLABLE_STATUSES.includes(s.status));
}

function cardOf(sub: Stripe.Subscription) {
  const pm = sub.default_payment_method;
  if (!pm || typeof pm === 'string') return {};
  return { payment_method_brand: pm.card?.brand ?? null, payment_method_last4: pm.card?.last4 ?? null };
}

/** Writes Stripe's current view of the organization into stripe_subscriptions and the org's plan row (which drives limits). */
export async function syncOrgFromStripe(
  stripe: Stripe, admin: SupabaseClient, orgId: string, state?: OrgStripeState,
): Promise<{ synced: boolean; planKey: string | null; state: OrgStripeState }> {
  const s = state ?? await loadOrgStripeState(stripe, admin, orgId);
  const plans = await loadPlans(admin);

  for (const c of s.customers) {
    const best = pickPrimarySubscription(s.byCustomer.get(c.customer_id) ?? []);
    const row = best
      ? {
          customer_id: c.customer_id,
          subscription_id: best.id,
          price_id: best.items.data[0]?.price?.id ?? null,
          current_period_start: best.current_period_start,
          current_period_end: best.current_period_end,
          cancel_at_period_end: best.cancel_at_period_end,
          status: best.status,
          ...cardOf(best),
        }
      : { customer_id: c.customer_id, status: 'not_started' };
    const { error } = await admin.from('stripe_subscriptions').upsert(row, { onConflict: 'customer_id' });
    if (error) throw new Error(`Failed to save Stripe subscription: ${error.message}`);
  }

  if (!s.primary || !s.primaryCustomer) return { synced: false, planKey: null, state: s };

  const match = planForPrice(plans, s.primary.items.data[0]?.price?.id);
  if (!match) {
    console.error('Subscription price does not match any active plan; organization plan left unchanged');
    return { synced: false, planKey: null, state: s };
  }

  const { error } = await admin.from('subscriptions').upsert({
    organization_id: orgId,
    user_id: s.primaryCustomer.user_id,
    plan_key: match.plan.plan_key,
    billing_cycle: match.cycle,
    status: toOrgStatus(s.primary.status),
    current_period_start: new Date(s.primary.current_period_start * 1000).toISOString(),
    current_period_end: new Date(s.primary.current_period_end * 1000).toISOString(),
  }, { onConflict: 'organization_id' });
  if (error) throw new Error(`Failed to save organization plan: ${error.message}`);
  return { synced: true, planKey: match.plan.plan_key, state: s };
}

const PORTAL_APP_TAG = 'lease-accountant';
let portalCache: { id: string; sig: string } | null = null;

/** Finds or creates our tagged portal configuration and keeps it in step with the active plan prices. */
export async function ensurePortalConfiguration(stripe: Stripe, admin: SupabaseClient): Promise<string> {
  const plans = await loadPlans(admin);
  const priceIds = allPriceIds(plans);
  const sig = `v2:${priceIds.join(',')}`;
  if (portalCache?.sig === sig) return portalCache.id;

  const existing = (await stripe.billingPortal.configurations.list({ limit: 100 }))
    .data.find((c) => c.metadata?.app === PORTAL_APP_TAG);
  if (existing?.active && existing.metadata?.sig === sig) {
    portalCache = { id: existing.id, sig };
    return existing.id;
  }

  const byProduct = new Map<string, string[]>();
  for (const id of priceIds) {
    const price = await stripe.prices.retrieve(id);
    if (!price.active || !price.recurring) throw new Error(`Plan price ...${id.slice(-4)} is inactive or not recurring in Stripe`);
    const product = typeof price.product === 'string' ? price.product : price.product.id;
    byProduct.set(product, [...(byProduct.get(product) ?? []), id]);
  }

  const params = {
    business_profile: { headline: 'Manage your Lease Accountant subscription' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] as Stripe.BillingPortal.ConfigurationCreateParams.Features.CustomerUpdate.AllowedUpdate[] },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' as const, proration_behavior: 'none' as const },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price' as const],
        proration_behavior: 'always_invoice' as const,
        products: [...byProduct].map(([product, prices]) => ({ product, prices })),
      },
    },
    metadata: { app: PORTAL_APP_TAG, sig },
  };

  const config = existing
    ? await stripe.billingPortal.configurations.update(existing.id, { ...params, active: true })
    : await stripe.billingPortal.configurations.create(params);
  portalCache = { id: config.id, sig };
  return config.id;
}

export async function orgUsage(admin: SupabaseClient, orgId: string): Promise<{ activeLeases: number; users: number }> {
  const [{ count, error: leaseError }, { data: cap, error: capError }] = await Promise.all([
    admin.from('leases').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
    admin.rpc('org_user_capacity', { p_org: orgId }),
  ]);
  const users = (cap as { used?: unknown } | null)?.used;
  if (leaseError || capError || typeof users !== 'number') throw new Error('Failed to check plan usage');
  return { activeLeases: count ?? 0, users };
}

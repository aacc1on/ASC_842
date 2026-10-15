export interface PlanRow {
  plan_key: string;
  plan_name: string;
  max_leases: number;
  max_users: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annually: string | null;
}

export interface SubscriptionLike {
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number | null;
  created?: number | null;
}

export type BillingCycle = 'monthly' | 'annually';

const ORG_STATUS: Record<string, string> = {
  active: 'active', trialing: 'trialing', past_due: 'past_due',
  canceled: 'cancelled', unpaid: 'cancelled', incomplete: 'cancelled',
  incomplete_expired: 'cancelled', paused: 'cancelled',
};

/** Stripe statuses that still bill the customer; a second subscription must not be created while one exists. */
export const BILLABLE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

export function toOrgStatus(stripeStatus: string): string {
  return ORG_STATUS[stripeStatus] ?? 'cancelled';
}

function rank(s: SubscriptionLike): number {
  const live = s.status === 'active' || s.status === 'trialing';
  if (live && !s.cancel_at_period_end) return 3;
  if (live) return 2;
  return BILLABLE_STATUSES.includes(s.status) ? 1 : 0;
}

/** The subscription that grants access longest: live and renewing, then live, then billable, then latest period end. */
export function pickPrimarySubscription<T extends SubscriptionLike>(subs: T[]): T | null {
  const sorted = [...subs].sort((a, b) =>
    rank(b) - rank(a)
    || (b.current_period_end ?? 0) - (a.current_period_end ?? 0)
    || (b.created ?? 0) - (a.created ?? 0));
  return sorted[0] ?? null;
}

export function planForPrice(plans: PlanRow[], priceId: string | null | undefined): { plan: PlanRow; cycle: BillingCycle } | null {
  if (!priceId) return null;
  for (const plan of plans) {
    if (plan.stripe_price_id_monthly === priceId) return { plan, cycle: 'monthly' };
    if (plan.stripe_price_id_annually === priceId) return { plan, cycle: 'annually' };
  }
  return null;
}

export function priceForPlan(plan: PlanRow, cycle: BillingCycle): string | null {
  return cycle === 'annually' ? plan.stripe_price_id_annually : plan.stripe_price_id_monthly;
}

export function allPriceIds(plans: PlanRow[]): string[] {
  return plans
    .flatMap((p) => [p.stripe_price_id_monthly, p.stripe_price_id_annually])
    .filter((id): id is string => !!id)
    .sort();
}

/** Reasons the organization cannot move to `target` given its current usage; empty when the switch is allowed. */
export function planLimitBlockers(usage: { activeLeases: number; users: number }, target: PlanRow): string[] {
  const reasons: string[] = [];
  if (usage.activeLeases > target.max_leases) {
    reasons.push(`You have ${usage.activeLeases} active leases, but ${target.plan_name} allows ${target.max_leases}. Archive or end ${usage.activeLeases - target.max_leases} lease${usage.activeLeases - target.max_leases === 1 ? '' : 's'} first.`);
  }
  if (usage.users > target.max_users) {
    reasons.push(`You have ${usage.users} users, but ${target.plan_name} allows ${target.max_users}. Remove ${usage.users - target.max_users} user${usage.users - target.max_users === 1 ? '' : 's'} first.`);
  }
  return reasons;
}

export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  const sep = id.indexOf('_');
  const prefix = sep > 0 ? id.slice(0, sep + 1) : '';
  return `${prefix}...${id.slice(-4)}`;
}

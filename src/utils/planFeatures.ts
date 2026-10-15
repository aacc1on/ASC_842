import { supabase } from '../lib/supabase';

export type PlanKey = 'starter' | 'professional' | 'enterprise' | 'trial' | 'expired';

export type PlanFeature = 'contract_modifications' | 'branches' | 'multi_user';

export interface MyPlan {
  plan_key: PlanKey;
  status: string;
  trial_ends_at: string | null;
  days_left: number | null;
  features: {
    contract_modifications: boolean;
    branches: boolean;
    multi_user: boolean;
  };
  max_users?: number;
  active_users?: number;
  over_user_limit?: boolean;
}

export function userLimitMessage(maxUsers: number): string {
  return `Your plan allows up to ${maxUsers} user${maxUsers === 1 ? '' : 's'}. Remove a user or contact us to add more.`;
}

/** A trial whose end date has passed is expired even before the hourly job rewrites the stored status. */
export function effectiveSubscriptionStatus(status: string, trialEndsAt: string | null, now: number = Date.now()): string {
  if (status === 'trialing' && trialEndsAt && new Date(trialEndsAt).getTime() <= now) return 'expired';
  return status;
}

export const EXPIRED_PLAN: MyPlan = {
  plan_key: 'expired',
  status: 'expired',
  trial_ends_at: null,
  days_left: null,
  features: {
    contract_modifications: false,
    branches: false,
    multi_user: false,
  },
  max_users: 1,
  active_users: 0,
  over_user_limit: false,
};

export async function fetchMyPlan(): Promise<MyPlan> {
  const { data, error } = await supabase.rpc('get_my_plan');
  if (error || !data) return EXPIRED_PLAN;
  return data as MyPlan;
}

export function hasFeature(planKey: PlanKey, feature: PlanFeature): boolean {
  if (planKey === 'expired') return false;
  if (planKey === 'enterprise' || planKey === 'trial') return true;
  if (planKey === 'professional' && (feature === 'contract_modifications' || feature === 'branches')) return true;
  return false;
}

export function planDisplayName(planKey: PlanKey): string {
  switch (planKey) {
    case 'starter': return 'Starter';
    case 'professional': return 'Professional';
    case 'enterprise': return 'Enterprise';
    case 'trial': return 'Free Trial';
    case 'expired': return 'Expired';
  }
}

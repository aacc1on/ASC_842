import { supabase } from '../lib/supabase';
import { SESSION_EXPIRED_MESSAGE, UserFacingError } from './errors';

/**
 * Tables whose rows belong to one organization. Every read of these from hooks/utils adds an explicit
 * `organization_id` filter (RLS remains the real protection); currentOrg.static.test.ts enforces it.
 */
export const ORG_SCOPED_TABLES = [
  'accounting_periods', 'accounting_policy_elections', 'amortization_schedules', 'approval_settings', 'audit_log',
  'branches', 'companies', 'contract_cancellations', 'contract_modifications', 'documents', 'error_logs',
  'fixed_asset_types', 'journal_entries', 'lease_impairments', 'lease_modifications', 'lease_payment_schedules',
  'lease_payments', 'lease_transactions', 'leases', 'lessors', 'month_end_catch_up_batches', 'month_end_catch_up_lines',
  'month_end_documents', 'subscriptions', 'transactions', 'user_activity_logs', 'user_profiles',
] as const;

const NO_ORG_MESSAGE = 'Your account is not linked to an organization. Please contact your administrator.';

let cached: { userId: string; orgId: Promise<string> } | null = null;

async function lookup(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const orgId = (data as { organization_id?: string } | null)?.organization_id;
  if (!orgId) throw new UserFacingError(NO_ORG_MESSAGE);
  return orgId;
}

/** The signed-in user's organization id (same source as the database's internal.current_org_id()). */
export async function currentOrgId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const userId = data?.session?.user?.id;
  if (error || !userId) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);
  if (cached?.userId !== userId) {
    const orgId = lookup(userId);
    cached = { userId, orgId };
    // A failed lookup must not stick for the rest of the session.
    orgId.catch(() => { if (cached?.orgId === orgId) cached = null; });
  }
  return cached.orgId;
}

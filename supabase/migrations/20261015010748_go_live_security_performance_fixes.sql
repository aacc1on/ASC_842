/*
# Go-live security and performance fixes

## Plain-English summary
Closes a cross-organization read leak on the "leases missing amortization" diagnostic view, pins the
search path on two helper functions, makes the two billing views read-only, and speeds up row-level
security checks and foreign-key lookups. No rows are changed.

## 1. leases_missing_amortization (security)
- Recreated WITH (security_invoker = true) so it runs with the caller's permissions and the leases /
  amortization_schedules row-level security applies.
- Adds an explicit `organization_id = internal.current_org_id()` filter as a second guard.
- anon loses all access; authenticated keeps SELECT only (INSERT/UPDATE/DELETE/TRUNCATE revoked).

## 2. Functions
- `internal.prevent_zero_amount_recognition()` and `internal.trial_days()` get `search_path = ''`
  (both bodies only use NEW / literals, so behaviour is unchanged).
- EXECUTE on four internal trigger functions is revoked from PUBLIC/anon (triggers still fire;
  trigger execution does not check the caller's EXECUTE privilege).

## 3. Billing views
- `stripe_org_invoices` and `stripe_org_subscriptions`: INSERT/UPDATE/DELETE/TRUNCATE revoked from
  anon and authenticated; authenticated keeps SELECT.

## 4. Row-level security performance (same meaning, evaluated once per query)
- `audit_log.audit_log_select_admin`, `error_logs.error_logs_select_admin`,
  `error_logs.error_logs_insert_own`, `accounting_policy_elections.select_policy_elections` now wrap
  auth.uid() / internal.current_org_id() in a scalar sub-select.
- `legal_acceptances`: the three permissive SELECT policies (own rows / org admin / platform owner)
  are merged into one policy "Read legal acceptances" that is their exact OR.

## 5. Indexes for unindexed foreign keys
- accounting_periods(user_id), approval_settings(updated_by), legal_acceptances(doc, version),
  lessors(user_id), stripe_invoices(plan_key). No indexes are dropped.
*/

CREATE OR REPLACE VIEW public.leases_missing_amortization
WITH (security_invoker = true) AS
SELECT
  l.id AS lease_id,
  l.organization_id,
  l.lease_name,
  l.lease_term_months,
  l.payment_amount,
  l.lease_liability,
  l.rou_asset,
  l.is_complete,
  l.created_at
FROM public.leases l
WHERE l.is_complete = true
  AND l.accounting_treatment = 'recognized'
  AND l.organization_id = internal.current_org_id()
  AND NOT EXISTS (SELECT 1 FROM public.amortization_schedules a WHERE a.lease_id = l.id);

REVOKE ALL ON public.leases_missing_amortization FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.leases_missing_amortization FROM authenticated;
GRANT SELECT ON public.leases_missing_amortization TO authenticated;

ALTER FUNCTION internal.prevent_zero_amount_recognition() SET search_path = '';
ALTER FUNCTION internal.trial_days() SET search_path = '';

REVOKE EXECUTE ON FUNCTION internal.prevent_locked_amortization_mutation() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_locked_payment_schedule_mutation() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.require_finance_classification_inputs() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.sync_accounting_period_lock() FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stripe_org_invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stripe_org_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.stripe_org_invoices TO authenticated;
GRANT SELECT ON public.stripe_org_subscriptions TO authenticated;

DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin" ON public.audit_log FOR SELECT TO authenticated
USING (
  organization_id = (SELECT internal.current_org_id())
  AND EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.user_id = (SELECT auth.uid())
      AND up.role = 'admin'
      AND up.organization_id = audit_log.organization_id
  )
);

DROP POLICY IF EXISTS "error_logs_select_admin" ON public.error_logs;
CREATE POLICY "error_logs_select_admin" ON public.error_logs FOR SELECT TO authenticated
USING (
  organization_id = (SELECT internal.current_org_id())
  AND EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.user_id = (SELECT auth.uid())
      AND up.role = 'admin'
      AND up.organization_id = error_logs.organization_id
  )
);

DROP POLICY IF EXISTS "error_logs_insert_own" ON public.error_logs;
CREATE POLICY "error_logs_insert_own" ON public.error_logs FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND organization_id = (SELECT internal.current_org_id())
);

DROP POLICY IF EXISTS "select_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "select_policy_elections" ON public.accounting_policy_elections FOR SELECT TO authenticated
USING (
  (SELECT internal.is_manage_or_admin())
  OR prepared_by = (SELECT auth.uid())
  OR created_by = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "Org admins read org legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Platform admin reads all legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Users read own legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Read legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Read legal acceptances" ON public.legal_acceptances FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT internal.is_platform_admin())
  OR (
    organization_id IS NOT NULL
    AND organization_id = (SELECT internal.current_org_id())
    AND (SELECT internal.is_admin())
  )
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_user_id ON public.accounting_periods (user_id);
CREATE INDEX IF NOT EXISTS idx_approval_settings_updated_by ON public.approval_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_doc_version ON public.legal_acceptances (doc, version);
CREATE INDEX IF NOT EXISTS idx_lessors_user_id ON public.lessors (user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_invoices_plan_key ON public.stripe_invoices (plan_key);

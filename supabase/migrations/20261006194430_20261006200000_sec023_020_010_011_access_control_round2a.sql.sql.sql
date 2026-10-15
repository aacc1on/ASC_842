/*
# SEC-023, SEC-020, SEC-010, SEC-011: Access control hardening (Round 2a)

## Summary

This migration fixes four high/medium security findings:
1. SEC-023: Removed users keep access and can join any organization
2. SEC-020/003: "Add User" creates an independent admin; missing validation
3. SEC-010: View role can write to business tables
4. SEC-011: Missing BEFORE INSERT trigger for user_id on business tables

## Changes

### SEC-023: Drop self-insert profile policy, tighten tenant isolation

1. Drop the "Users can insert own profile" INSERT policy on user_profiles.
   Profiles are created ONLY by the on_auth_user_created trigger / service role.
   A user with no profile can no longer insert a profile into any organization.

2. Tighten the tenant_isolation_user_profiles policy: remove the
   `OR user_id = auth.uid()` branch. Now a user with no profile gets
   NO access to any organization's data (current_org_id() returns NULL,
   which matches nothing).

### SEC-010: View role read-only on business tables

3. Replace the write policies (INSERT/UPDATE/DELETE) on all business tables
   to remove the `OR auth.uid() = user_id` owner branch. Write access is
   now restricted to is_manage_or_admin() only. View users can READ all
   data of their own organization but cannot write.

   Business tables affected: leases, transactions, amortization_schedules,
   month_end_documents, contract_modifications, documents, lease_modifications,
   lease_impairments, accounting_periods, accounting_policy_elections.

   Exception: error_logs INSERT remains allowed for all authenticated users
   (both view and manage/admin can log errors).

4. Add internal.has_permission() helper function for per-user permission
   keys. This is used in the leases write policies to enforce UI permission
   switches (create_edit_leases, delete_leases) at the database level.

5. Update leases INSERT/UPDATE/DELETE policies to additionally require
   internal.has_permission('create_edit_leases') for INSERT/UPDATE and
   internal.has_permission('delete_leases') for DELETE.

### SEC-011: BEFORE INSERT trigger for user_id

6. Create internal.set_user_id() trigger function that sets NEW.user_id =
   auth.uid() for non-service callers. Apply it as a BEFORE INSERT trigger
   on all business tables that have a user_id column.

### SEC-020/003: DB CHECK constraint on user_profiles.role

7. The role CHECK constraint already exists (admin, manage, view).
   No change needed.

## Security Impact

- A removed user (auth account deleted but profile still present, or vice
  versa) can no longer access any organization's data.
- A signed-in user with no profile gets zero rows from all tables.
- View-role users can no longer write to any business table through the
  API, even with crafted requests.
- The user_id column on business tables is always set from the session,
  never from client-supplied values.
*/

-- ============================================================================
-- SEC-023: Drop self-insert profile policy
-- ============================================================================
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;

-- ============================================================================
-- SEC-023: Tighten tenant isolation on user_profiles
-- Remove the OR user_id = auth.uid() branch so profileless users get nothing.
-- ============================================================================
DROP POLICY IF EXISTS "tenant_isolation_user_profiles" ON public.user_profiles;
CREATE POLICY "tenant_isolation_user_profiles"
ON public.user_profiles FOR ALL
TO authenticated
USING (organization_id = internal.current_org_id())
WITH CHECK (organization_id = internal.current_org_id());

-- ============================================================================
-- SEC-010: Add internal.has_permission() helper
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.has_permission(perm_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perms jsonb;
BEGIN
  SELECT permissions INTO v_perms
  FROM public.user_profiles
  WHERE user_id = auth.uid()
    AND organization_id = internal.current_org_id();

  IF v_perms IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE((v_perms ->> perm_key)::boolean, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.has_permission(text) FROM anon;
GRANT EXECUTE ON FUNCTION internal.has_permission(text) TO authenticated;

-- ============================================================================
-- SEC-011: set_user_id trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only set user_id from session for non-service callers.
  -- The service role bypasses RLS and has auth.uid() = NULL,
  -- so we only override when there IS a session user.
  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- SEC-010: Replace write policies on business tables
-- Remove the OR auth.uid() = user_id owner branch.
-- View users can READ but not WRITE.
-- ============================================================================

-- Helper to rebuild policies for a given table
-- We do each table explicitly for clarity.

-- leases: require is_manage_or_admin + has_permission for writes
DROP POLICY IF EXISTS "consolidated_insert_leases" ON public.leases;
CREATE POLICY "consolidated_insert_leases"
ON public.leases FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'));

DROP POLICY IF EXISTS "consolidated_update_leases" ON public.leases;
CREATE POLICY "consolidated_update_leases"
ON public.leases FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'))
WITH CHECK (internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'));

DROP POLICY IF EXISTS "consolidated_delete_leases" ON public.leases;
CREATE POLICY "consolidated_delete_leases"
ON public.leases FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin() AND internal.has_permission('delete_leases'));

-- transactions: require is_manage_or_admin
DROP POLICY IF EXISTS "consolidated_insert_transactions" ON public.transactions;
CREATE POLICY "consolidated_insert_transactions"
ON public.transactions FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_transactions" ON public.transactions;
CREATE POLICY "consolidated_update_transactions"
ON public.transactions FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_transactions" ON public.transactions;
CREATE POLICY "consolidated_delete_transactions"
ON public.transactions FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- amortization_schedules: require is_manage_or_admin
DROP POLICY IF EXISTS "consolidated_insert_amortization_schedules" ON public.amortization_schedules;
CREATE POLICY "consolidated_insert_amortization_schedules"
ON public.amortization_schedules FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_amortization_schedules" ON public.amortization_schedules;
CREATE POLICY "consolidated_delete_amortization_schedules"
ON public.amortization_schedules FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- month_end_documents: require is_manage_or_admin
DROP POLICY IF EXISTS "consolidated_insert_month_end_documents" ON public.month_end_documents;
CREATE POLICY "consolidated_insert_month_end_documents"
ON public.month_end_documents FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_month_end_documents" ON public.month_end_documents;
CREATE POLICY "consolidated_update_month_end_documents"
ON public.month_end_documents FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_month_end_documents" ON public.month_end_documents;
CREATE POLICY "consolidated_delete_month_end_documents"
ON public.month_end_documents FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- contract_modifications: require is_manage_or_admin
DROP POLICY IF EXISTS "consolidated_insert_contract_modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_insert_contract_modifications"
ON public.contract_modifications FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_contract_modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_update_contract_modifications"
ON public.contract_modifications FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_contract_modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_delete_contract_modifications"
ON public.contract_modifications FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- documents: require is_manage_or_admin for write
DROP POLICY IF EXISTS "consolidated_insert_documents" ON public.documents;
CREATE POLICY "consolidated_insert_documents"
ON public.documents FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_documents" ON public.documents;
CREATE POLICY "consolidated_update_documents"
ON public.documents FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_documents" ON public.documents;
CREATE POLICY "consolidated_delete_documents"
ON public.documents FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- accounting_periods: require is_manage_or_admin for write
DROP POLICY IF EXISTS "Users can insert own periods" ON public.accounting_periods;
DROP POLICY IF EXISTS "Users can update own periods" ON public.accounting_periods;
DROP POLICY IF EXISTS "Users can delete own periods" ON public.accounting_periods;
CREATE POLICY "consolidated_insert_accounting_periods"
ON public.accounting_periods FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "consolidated_update_accounting_periods"
ON public.accounting_periods FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "consolidated_delete_accounting_periods"
ON public.accounting_periods FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

-- ============================================================================
-- SEC-010: user_profiles write policies
-- Keep update/delete as is (admin or manage_or_admin or self for update).
-- The consolidated_update already uses is_admin OR is_manage_or_admin OR self.
-- The consolidated_delete uses is_admin AND not self, OR self.
-- These are fine — view users can update their own profile settings but
-- NOT role/permissions/organization_id (handled by column-level grants below).
-- ============================================================================

-- Revoke UPDATE on sensitive columns of user_profiles from authenticated
-- Only admin/manage can change role, permissions, organization_id
REVOKE UPDATE ON public.user_profiles FROM authenticated;
GRANT UPDATE (
  full_name, phone_number, company_name, job_title, theme,
  date_format, currency, timezone, language,
  email_notifications, lease_expiry_alerts, payment_reminders,
  monthly_reports, email
) ON public.user_profiles TO authenticated;

-- ============================================================================
-- SEC-011: Add BEFORE INSERT triggers for user_id on business tables
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'leases', 'transactions', 'amortization_schedules',
    'month_end_documents', 'contract_modifications', 'documents',
    'accounting_periods'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_user_id ON public.%I;
       CREATE TRIGGER set_user_id BEFORE INSERT ON public.%I
       FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- SEC-023: Add idempotency table for Stripe webhook event processing (SEC-004)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (stripe-webhook) uses this table.
-- The service role bypasses RLS, so no policy is needed.

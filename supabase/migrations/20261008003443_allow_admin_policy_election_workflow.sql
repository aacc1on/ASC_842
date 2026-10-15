/*
# Allow organization admins to manage policy election approvals

1. Purpose
- Allow authenticated organization admins to create, submit, approve, and reject ASC 842 policy elections even when the organization subscription is inactive.
- Keep subscription enforcement for non-admin users unchanged.

2. Modified table
- `public.accounting_policy_elections`
- No columns, rows, or table structure are changed.

3. Security changes
- Replaces the restrictive INSERT, UPDATE, and DELETE subscription policies for this table.
- The subscription requirement now passes when either the organization has an active subscription or the caller is an organization admin.
- Tenant isolation and the existing permissive role policies remain unchanged.

4. Important notes
- This does not grant approval access to non-admin users.
- The existing database trigger continues to enforce administrator-only approval, segregation of duties, audit fields, and policy-specific validation.
*/

DROP POLICY IF EXISTS "subscription_required_insert_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_insert_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_admin())
  );

DROP POLICY IF EXISTS "subscription_required_update_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_update_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_admin())
  )
  WITH CHECK (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_admin())
  );

DROP POLICY IF EXISTS "subscription_required_delete_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_delete_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_admin())
  );
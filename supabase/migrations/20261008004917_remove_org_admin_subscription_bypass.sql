/*
# Remove the ordinary-admin subscription bypass

1. Purpose
- Ensure ordinary organization administrators do not bypass inactive subscription gating.

2. Modified table
- `public.accounting_policy_elections`
- Replaces its restrictive INSERT, UPDATE, and DELETE policies.

3. Security
- Access is allowed only when the organization has an active subscription or the caller is the platform owner.
- The previous organization-admin exception is removed.
- Tenant isolation, administrator approval checks, and the trial self-approval trigger remain unchanged.
*/

DROP POLICY IF EXISTS "subscription_required_insert_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_insert_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_platform_admin())
  );

DROP POLICY IF EXISTS "subscription_required_update_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_update_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_platform_admin())
  )
  WITH CHECK (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_platform_admin())
  );

DROP POLICY IF EXISTS "subscription_required_delete_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_delete_accounting_policy_elections"
  ON public.accounting_policy_elections AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT internal.org_has_active_subscription())
    OR (SELECT internal.is_platform_admin())
  );
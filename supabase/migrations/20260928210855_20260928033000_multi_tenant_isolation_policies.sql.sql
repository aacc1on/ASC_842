/*
# Multi-tenant: restrictive tenant-isolation policies

## What this does
Adds a RESTRICTIVE policy (AS RESTRICTIVE) on every business table and user_profiles
so that existing permissive policies (role-based admin/manage/view) are now ANDed
with a tenant check: the row's organization_id must match the caller's current_org_id().

This means admin/manage/view role rules still apply, but they are now scoped to
the caller's own organization. A user in Org A cannot see or modify any data
belonging to Org B, even if they have admin role.

## Tables affected
- user_profiles: restrictive policy allows own org OR own user_id
- leases, lease_payments, amortization_schedules, journal_entries, lease_modifications,
  user_activity_logs, documents, transactions, contract_modifications, contract_cancellations,
  accounting_periods, branches, lease_transactions, month_end_documents, lease_payment_schedules,
  companies, fixed_asset_types: restrictive policy = organization_id = current_org_id()

## Note
No existing permissive policies are dropped or modified. Restrictive policies
interact with permissive policies via AND logic in PostgreSQL RLS.
*/

-- ============================================================
-- Restrictive policy on user_profiles
-- ============================================================
DROP POLICY IF EXISTS "tenant_isolation_user_profiles" ON public.user_profiles;
CREATE POLICY "tenant_isolation_user_profiles"
  ON public.user_profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()) OR user_id = (SELECT auth.uid()))
  WITH CHECK (organization_id = (SELECT internal.current_org_id()) OR user_id = (SELECT auth.uid()));

-- ============================================================
-- Restrictive policies on all business tables
-- ============================================================
DO $$
DECLARE
  tbl text;
  policy_name text;
  business_tables text[] := ARRAY[
    'leases','lease_payments','amortization_schedules',
    'journal_entries','lease_modifications','user_activity_logs','documents',
    'transactions','contract_modifications','contract_cancellations',
    'accounting_periods','branches','lease_transactions','month_end_documents',
    'lease_payment_schedules','companies','fixed_asset_types'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    policy_name := 'tenant_isolation_' || tbl;
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (organization_id = (SELECT internal.current_org_id()))
         WITH CHECK (organization_id = (SELECT internal.current_org_id()))',
        policy_name, tbl
      );
    END;
  END LOOP;
END $$;

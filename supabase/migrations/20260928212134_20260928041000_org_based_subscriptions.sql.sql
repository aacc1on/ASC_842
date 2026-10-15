/*
# Organization-based subscriptions

## Changes:
1. subscriptions: added organization_id, backfilled, NOT NULL, unique index
2. Removed client INSERT/UPDATE/DELETE policies; SELECT only for own org
3. Fixed admin user org_id (was accidentally changed during testing)
4. Fixed enforce_role_permissions_guard to block org_id changes for ALL authenticated callers
5. Complimentary enterprise subscription for Default Organization
6. org_has_active_subscription() function
7. create_user_profile: creates trial subscription on new org signup
8. Lease limit trigger based on plan max_leases
9. Write-restrictive policies on business tables (expired orgs can read but not write)
*/

-- ============================================================
-- 1. Add organization_id to subscriptions
-- ============================================================
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON public.subscriptions(organization_id);

-- ============================================================
-- 2. Backfill subscriptions.organization_id from user_profiles
-- ============================================================
UPDATE public.subscriptions s
SET organization_id = up.organization_id
FROM public.user_profiles up
WHERE s.user_id = up.user_id AND s.organization_id IS NULL;

-- Make user_id nullable (org-based, not user-based)
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;

-- Add unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org_unique ON public.subscriptions(organization_id);

-- Set organization_id NOT NULL
ALTER TABLE public.subscriptions ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 3. Fix admin user org_id back to Default Organization
-- ============================================================
DO $$
DECLARE
  v_default_org_id uuid;
BEGIN
  SELECT id INTO v_default_org_id FROM public.organizations WHERE name = 'Default Organization';
  IF v_default_org_id IS NOT NULL THEN
    ALTER TABLE public.user_profiles DISABLE TRIGGER enforce_role_permissions_guard;
    UPDATE public.user_profiles SET organization_id = v_default_org_id
    WHERE user_id = '768308c8-0b63-4f1a-aed1-d7deeb00aa31'
    AND organization_id != v_default_org_id;
    ALTER TABLE public.user_profiles ENABLE TRIGGER enforce_role_permissions_guard;
  END IF;
END $$;

-- ============================================================
-- 4. Fix enforce_role_permissions_guard
-- ============================================================
CREATE OR REPLACE FUNCTION internal.enforce_role_permissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  is_srv_role boolean := (SELECT auth.role() = 'service_role');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      IF caller_uid IS NOT NULL AND NOT is_srv_role THEN
        RAISE EXCEPTION 'You do not have permission to change organization_id';
      END IF;
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.permissions IS DISTINCT FROM OLD.permissions) THEN
      IF caller_uid IS NULL THEN
        RETURN NEW;
      END IF;
      IF is_srv_role THEN
        RETURN NEW;
      END IF;
      IF internal.is_admin() THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'You do not have permission to change role or permissions';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF caller_uid IS NOT NULL AND NOT is_srv_role AND NOT internal.is_admin() THEN
      NEW.role := 'view';
      NEW.permissions := '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": false, "access_user_management": false}'::jsonb;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.enforce_role_permissions_guard() FROM public, anon, authenticated;

-- ============================================================
-- 5. Remove client write policies on subscriptions, add org-scoped SELECT
-- ============================================================
DROP POLICY IF EXISTS "delete_own_subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "insert_own_subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "update_own_subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "select_own_subscription" ON public.subscriptions;

CREATE POLICY "select_own_org_subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()));

-- ============================================================
-- 6. Complimentary enterprise subscription for Default Organization
-- ============================================================
DO $$
DECLARE
  v_default_org_id uuid;
  v_admin_user_id uuid;
BEGIN
  SELECT id INTO v_default_org_id FROM public.organizations WHERE name = 'Default Organization';
  SELECT user_id INTO v_admin_user_id FROM public.user_profiles WHERE organization_id = v_default_org_id LIMIT 1;

  IF v_default_org_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (organization_id, user_id, plan_key, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
    VALUES (v_default_org_id, v_admin_user_id, 'enterprise', 'annually', 'active', NULL, now(), NULL)
    ON CONFLICT (organization_id) DO UPDATE SET
      plan_key = 'enterprise',
      status = 'active',
      current_period_end = NULL,
      trial_ends_at = NULL;
  END IF;
END $$;

-- ============================================================
-- 7. org_has_active_subscription()
-- ============================================================
CREATE OR REPLACE FUNCTION internal.org_has_active_subscription()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.organization_id = internal.current_org_id()
    AND (
      (s.status = 'trialing' AND s.trial_ends_at > now())
      OR
      (s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
    )
  )
$$;

GRANT EXECUTE ON FUNCTION internal.org_has_active_subscription() TO authenticated;
REVOKE EXECUTE ON FUNCTION internal.org_has_active_subscription() FROM public, anon;

-- ============================================================
-- 8. Update create_user_profile: create trial subscription on new org
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
BEGIN
  v_org_id := NEW.raw_app_meta_data->>'organization_id';

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.user_profiles (user_id, email, organization_id, role, permissions)
    VALUES (NEW.id, NEW.email, v_org_id, 'view',
      '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": false, "access_user_management": false}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  ELSE
    v_org_name := COALESCE(NEW.raw_user_meta_data->>'company_name', NEW.email);
    INSERT INTO public.organizations (name) VALUES (v_org_name) RETURNING id INTO v_org_id;

    INSERT INTO public.user_profiles (user_id, email, organization_id, role, permissions)
    VALUES (NEW.id, NEW.email, v_org_id, 'admin',
      '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": true, "access_user_management": true}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

    INSERT INTO public.subscriptions (organization_id, user_id, plan_key, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
    VALUES (v_org_id, NEW.id, 'starter', 'monthly', 'trialing', now() + interval '5 days', now(), now() + interval '1 month')
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 9. Lease limit trigger
-- ============================================================
CREATE OR REPLACE FUNCTION internal.enforce_lease_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_max_leases int;
  v_current_count int;
  v_plan_key text;
BEGIN
  v_org_id := NEW.organization_id;
  IF v_org_id IS NULL THEN
    v_org_id := internal.current_org_id();
  END IF;

  SELECT s.plan_key INTO v_plan_key
  FROM public.subscriptions s
  WHERE s.organization_id = v_org_id
  LIMIT 1;

  SELECT sp.max_leases INTO v_max_leases
  FROM public.subscription_plans sp
  WHERE sp.plan_key = v_plan_key
  LIMIT 1;

  IF v_max_leases IS NULL THEN
    v_max_leases := 50;
  END IF;

  SELECT count(*) INTO v_current_count
  FROM public.leases l
  WHERE l.organization_id = v_org_id
    AND l.status = 'active'
    AND l.id IS DISTINCT FROM NEW.id;

  IF v_current_count >= v_max_leases THEN
    RAISE EXCEPTION 'Your plan allows up to % active leases. Please upgrade to add more.', v_max_leases;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.enforce_lease_limit() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_lease_limit ON public.leases;
CREATE TRIGGER enforce_lease_limit
  BEFORE INSERT ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION internal.enforce_lease_limit();

-- ============================================================
-- 10. Write-restrictive policies on business tables
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
    policy_name := 'subscription_required_insert_' || tbl;
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK ((SELECT internal.org_has_active_subscription()))',
        policy_name, tbl
      );
    END;

    policy_name := 'subscription_required_update_' || tbl;
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING ((SELECT internal.org_has_active_subscription()))
         WITH CHECK ((SELECT internal.org_has_active_subscription()))',
        policy_name, tbl
      );
    END;

    policy_name := 'subscription_required_delete_' || tbl;
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING ((SELECT internal.org_has_active_subscription()))',
        policy_name, tbl
      );
    END;
  END LOOP;
END $$;

/*
# Multi-tenant: backfill organizations and organization_id

## Backfill plan
1. Create one "Default Organization" for admin users who have no subscription
2. Each user who has a row in public.subscriptions gets their own new organization and becomes role 'admin' of it
3. Users without a subscription row → Default Organization (keeping their current role)
4. Backfill organization_id on all business table rows from the organization of the row's user_id, falling back to Default Organization
5. Set organization_id NOT NULL on user_profiles and all business tables

Triggers are temporarily disabled during backfill, then re-enabled.
No existing data is deleted.
*/

-- ============================================================
-- 1. Temporarily disable triggers to allow backfill
-- ============================================================
DO $$
DECLARE
  tbl text;
  business_tables text[] := ARRAY[
    'leases','lease_payments','amortization_schedules',
    'journal_entries','lease_modifications','user_activity_logs','documents',
    'transactions','contract_modifications','contract_cancellations',
    'accounting_periods','branches','lease_transactions','month_end_documents',
    'lease_payment_schedules','companies','fixed_asset_types'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER set_organization_id', tbl);
  END LOOP;
  -- Also disable the role permissions guard on user_profiles
  ALTER TABLE public.user_profiles DISABLE TRIGGER enforce_role_permissions_guard;
END $$;

-- ============================================================
-- 2. Create Default Organization
-- ============================================================
DO $$
DECLARE
  v_default_org_id uuid;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('Default Organization')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_default_org_id;

  IF v_default_org_id IS NULL THEN
    SELECT id INTO v_default_org_id FROM public.organizations WHERE name = 'Default Organization';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _default_org AS
  SELECT v_default_org_id AS org_id;
END $$;

-- ============================================================
-- 3. Create individual orgs for subscribed users, set org_id on user_profiles
-- ============================================================
DO $$
DECLARE
  v_default_org_id uuid;
  v_org_id uuid;
  v_user_id uuid;
  v_email text;
  v_org_name text;
BEGIN
  SELECT org_id INTO v_default_org_id FROM _default_org;

  -- Users WITH a subscription row get their own org as admin
  FOR v_user_id, v_email IN
    SELECT s.user_id, COALESCE(up.email, au.email)
    FROM public.subscriptions s
    JOIN auth.users au ON au.id = s.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = s.user_id
  LOOP
    v_org_name := COALESCE(v_email, 'Organization for ' || v_user_id::text);
    INSERT INTO public.organizations (name) VALUES (v_org_name) RETURNING id INTO v_org_id;

    UPDATE public.user_profiles
    SET organization_id = v_org_id,
        role = 'admin',
        permissions = '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": true, "access_user_management": true}'::jsonb
    WHERE user_id = v_user_id;
  END LOOP;

  -- Users WITHOUT a subscription row → Default Organization (keep their current role)
  UPDATE public.user_profiles
  SET organization_id = v_default_org_id
  WHERE organization_id IS NULL
    AND user_id NOT IN (SELECT user_id FROM public.subscriptions);
END $$;

-- ============================================================
-- 4. Backfill organization_id on all business tables
-- ============================================================
DO $$
DECLARE
  v_default_org_id uuid;
BEGIN
  SELECT org_id INTO v_default_org_id FROM _default_org;

  -- Tables with user_id column: backfill from user_profiles
  UPDATE public.accounting_periods ap
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE ap.user_id = up.user_id AND ap.organization_id IS NULL;

  UPDATE public.branches b
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE b.user_id = up.user_id AND b.organization_id IS NULL;

  UPDATE public.companies c
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE c.user_id = up.user_id AND c.organization_id IS NULL;

  UPDATE public.contract_cancellations cc
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE cc.user_id = up.user_id AND cc.organization_id IS NULL;

  UPDATE public.contract_modifications cm
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE cm.user_id = up.user_id AND cm.organization_id IS NULL;

  UPDATE public.documents d
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE d.user_id = up.user_id AND d.organization_id IS NULL;

  UPDATE public.fixed_asset_types fat
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE fat.user_id = up.user_id AND fat.organization_id IS NULL;

  UPDATE public.lease_transactions lt
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE lt.user_id = up.user_id AND lt.organization_id IS NULL;

  UPDATE public.leases l
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE l.user_id = up.user_id AND l.organization_id IS NULL;

  UPDATE public.month_end_documents med
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE med.user_id = up.user_id AND med.organization_id IS NULL;

  UPDATE public.transactions t
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE t.user_id = up.user_id AND t.organization_id IS NULL;

  UPDATE public.user_activity_logs ual
    SET organization_id = COALESCE(up.organization_id, v_default_org_id)
    FROM public.user_profiles up
    WHERE ual.user_id = up.user_id AND ual.organization_id IS NULL;

  -- Child tables: backfill from parent lease
  UPDATE public.amortization_schedules a
    SET organization_id = COALESCE(l.organization_id, v_default_org_id)
    FROM public.leases l
    WHERE a.lease_id = l.id AND a.organization_id IS NULL;

  UPDATE public.journal_entries je
    SET organization_id = COALESCE(l.organization_id, v_default_org_id)
    FROM public.leases l
    WHERE je.lease_id = l.id AND je.organization_id IS NULL;

  UPDATE public.lease_modifications lm
    SET organization_id = COALESCE(l.organization_id, v_default_org_id)
    FROM public.leases l
    WHERE lm.lease_id = l.id AND lm.organization_id IS NULL;

  UPDATE public.lease_payments lp
    SET organization_id = COALESCE(l.organization_id, v_default_org_id)
    FROM public.leases l
    WHERE lp.lease_id = l.id AND lp.organization_id IS NULL;

  UPDATE public.lease_payment_schedules lps
    SET organization_id = COALESCE(l.organization_id, v_default_org_id)
    FROM public.leases l
    WHERE lps.lease_id = l.id AND lps.organization_id IS NULL;
END $$;

-- ============================================================
-- 5. Set organization_id NOT NULL on user_profiles and all business tables
-- ============================================================
DO $$
DECLARE
  tbl text;
  business_tables text[] := ARRAY[
    'user_profiles','leases','lease_payments','amortization_schedules',
    'journal_entries','lease_modifications','user_activity_logs','documents',
    'transactions','contract_modifications','contract_cancellations',
    'accounting_periods','branches','lease_transactions','month_end_documents',
    'lease_payment_schedules','companies','fixed_asset_types'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', tbl);
    END;
  END LOOP;
END $$;

-- ============================================================
-- 6. Re-enable triggers
-- ============================================================
DO $$
DECLARE
  tbl text;
  business_tables text[] := ARRAY[
    'leases','lease_payments','amortization_schedules',
    'journal_entries','lease_modifications','user_activity_logs','documents',
    'transactions','contract_modifications','contract_cancellations',
    'accounting_periods','branches','lease_transactions','month_end_documents',
    'lease_payment_schedules','companies','fixed_asset_types'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER set_organization_id', tbl);
  END LOOP;
  ALTER TABLE public.user_profiles ENABLE TRIGGER enforce_role_permissions_guard;
END $$;

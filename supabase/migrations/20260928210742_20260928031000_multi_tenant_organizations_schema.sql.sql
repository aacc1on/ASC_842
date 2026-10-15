/*
# Multi-tenant isolation: organizations table, columns, and triggers

## 1. New Tables
- `public.organizations`
  - `id` (uuid, PK, default gen_random_uuid())
  - `name` (text, NOT NULL)
  - `created_at` (timestamptz, default now())
  - RLS enabled: members can SELECT their own org only; no client INSERT/UPDATE/DELETE

## 2. Modified Tables — added `organization_id uuid REFERENCES organizations(id)` to:
- user_profiles, leases, lease_payments, amortization_schedules, journal_entries,
  lease_modifications, user_activity_logs, documents, transactions,
  contract_modifications, contract_cancellations, accounting_periods,
  branches, lease_transactions, month_end_documents, lease_payment_schedules,
  companies, fixed_asset_types
- Index created on organization_id for each table

## 3. New Functions
- `internal.current_org_id()` — SECURITY DEFINER STABLE, returns the caller's organization_id from user_profiles
- `internal.set_organization_id()` — SECURITY DEFINER trigger function that sets NEW.organization_id on INSERT and forbids changing it on UPDATE

## 4. Triggers
- BEFORE INSERT OR UPDATE on each business table → calls internal.set_organization_id()
- Updated internal.enforce_role_permissions_guard to also block organization_id changes on user_profiles

## 5. Updated Functions
- `public.create_user_profile()` — now handles organization_id from app_metadata or creates a new org
- `internal.get_user_emails_for_admin()` — filtered by caller's organization_id
- `internal.is_admin()`, `internal.is_manage_or_admin()`, `internal.has_data_access()` — filtered by organization_id

## 6. Security
- RLS on organizations: SELECT only for members, no client writes
- Grant EXECUTE on internal.current_org_id() to authenticated
- Revoke EXECUTE on internal.set_organization_id() from public/anon/authenticated
*/

-- ============================================================
-- 1. Create organizations table (without RLS policy yet)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Add organization_id column to all business tables
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
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL',
        tbl
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%I_organization_id ON public.%I(organization_id)',
        tbl, tbl
      );
    END;
  END LOOP;
END $$;

-- ============================================================
-- 3. internal.current_org_id() — returns caller's organization_id
-- ============================================================
CREATE OR REPLACE FUNCTION internal.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT organization_id FROM public.user_profiles WHERE user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION internal.current_org_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION internal.current_org_id() FROM public, anon;

-- ============================================================
-- 4. Now add RLS policy on organizations (function exists)
-- ============================================================
DROP POLICY IF EXISTS "Members can view own organization" ON public.organizations;
CREATE POLICY "Members can view own organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (id = (SELECT internal.current_org_id()));

-- ============================================================
-- 5. internal.set_organization_id() — trigger function for business tables
-- ============================================================
CREATE OR REPLACE FUNCTION internal.set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      NEW.organization_id := internal.current_org_id();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'organization_id cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.set_organization_id() FROM public, anon, authenticated;

-- Create triggers on all business tables (not user_profiles - it has its own guard)
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
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS set_organization_id ON public.%I', tbl);
      EXECUTE format(
        'CREATE TRIGGER set_organization_id BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id()',
        tbl
      );
    END;
  END LOOP;
END $$;

-- ============================================================
-- 6. Extend enforce_role_permissions_guard to block organization_id changes
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
    -- Block organization_id changes by non-service, non-admin callers
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      IF caller_uid IS NOT NULL AND NOT is_srv_role AND NOT internal.is_admin() THEN
        RAISE EXCEPTION 'You do not have permission to change organization_id';
      END IF;
    END IF;
    -- Block role/permissions changes by non-admin callers
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
-- 7. Update create_user_profile for org-aware signup
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
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 8. Update internal helper functions to be org-scoped
-- ============================================================
CREATE OR REPLACE FUNCTION internal.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
    AND organization_id = internal.current_org_id()
  );
END;
$$;

CREATE OR REPLACE FUNCTION internal.is_manage_or_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
    AND organization_id = internal.current_org_id()
  );
END;
$$;

CREATE OR REPLACE FUNCTION internal.has_data_access()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
    AND organization_id = internal.current_org_id()
  );
END;
$$;

-- get_user_emails_for_admin — org-scoped
CREATE OR REPLACE FUNCTION internal.get_user_emails_for_admin()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := internal.current_org_id();
  IF v_org_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND role IN ('admin', 'manage')
    AND organization_id = v_org_id
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au
  JOIN public.user_profiles up ON up.user_id = au.id
  WHERE up.organization_id = v_org_id;
END;
$$;

-- Re-grant/revoke
GRANT EXECUTE ON FUNCTION internal.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_manage_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.has_data_access() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.get_user_emails_for_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION internal.is_admin() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.is_admin(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.is_manage_or_admin() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.has_data_access() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.get_user_emails_for_admin() FROM public, anon;

/*
  # Move SECURITY DEFINER helper functions to internal schema

  1. Problem
    - Functions `is_admin()`, `is_admin(uuid)`, `is_manage_or_admin()`, `has_data_access()`,
      and `get_user_emails_for_admin()` are exposed as callable RPC endpoints via PostgREST
    - Any authenticated user can invoke these SECURITY DEFINER functions directly

  2. Fix
    - Create an `internal` schema (not exposed by PostgREST)
    - Recreate all helper functions in `internal` schema
    - Drop and recreate ALL RLS policies that reference these functions
    - Drop the old public schema functions
    - Grant EXECUTE to `authenticated` on internal functions (required for RLS evaluation)

  3. Tables with policy changes
    - user_profiles (is_admin, is_manage_or_admin)
    - leases, branches, documents, contract_modifications, contract_cancellations,
      lease_transactions, month_end_documents, accounting_periods, transactions,
      fixed_asset_types, amortization_schedules, journal_entries, lease_modifications,
      lease_payment_schedules, lease_payments (has_data_access)

  4. Security
    - Functions are no longer callable via /rest/v1/rpc/
    - RLS policies continue to work via internal schema references
*/

-- Create internal schema for helper functions
CREATE SCHEMA IF NOT EXISTS internal;

-- Recreate functions in internal schema
CREATE OR REPLACE FUNCTION internal.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.is_admin(check_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = check_user_id AND role = 'admin' AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.is_manage_or_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.has_data_access()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.get_user_emails_for_admin()
RETURNS TABLE(user_id uuid, email text) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid() AND role IN ('admin', 'manage')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant EXECUTE on internal schema to authenticated (needed for RLS policy evaluation)
GRANT USAGE ON SCHEMA internal TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_manage_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.has_data_access() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.get_user_emails_for_admin() TO authenticated;

-- Revoke from public/anon
REVOKE ALL ON SCHEMA internal FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.is_admin() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.is_admin(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.is_manage_or_admin() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.has_data_access() FROM public, anon;
REVOKE EXECUTE ON FUNCTION internal.get_user_emails_for_admin() FROM public, anon;

-- Drop all policies that reference the old public functions

-- user_profiles policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view own profile or admin views all" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile or admin updates all" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;

-- has_data_access policies on all data tables
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON leases;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON branches;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON documents;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_modifications;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_cancellations;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_transactions;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON month_end_documents;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON accounting_periods;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON transactions;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON fixed_asset_types;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON amortization_schedules;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON journal_entries;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_modifications;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payments;

-- Now drop the old public functions (no more dependencies)
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_admin(uuid);
DROP FUNCTION IF EXISTS public.is_manage_or_admin();
DROP FUNCTION IF EXISTS public.has_data_access();
DROP FUNCTION IF EXISTS public.get_user_emails_for_admin();

-- Recreate user_profiles policies using internal.* functions
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT TO authenticated
  USING (internal.is_admin());

CREATE POLICY "Manage role can view all profiles"
  ON user_profiles FOR SELECT TO authenticated
  USING (internal.is_manage_or_admin());

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all profiles"
  ON user_profiles FOR UPDATE TO authenticated
  USING (internal.is_admin())
  WITH CHECK (internal.is_admin());

CREATE POLICY "Manage role can update user profiles"
  ON user_profiles FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can delete profiles"
  ON user_profiles FOR DELETE TO authenticated
  USING (internal.is_admin() AND user_id <> auth.uid());

-- Recreate shared data access policies using internal.has_data_access()
CREATE POLICY "Shared data access for manage and admin roles"
  ON leases FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON branches FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON documents FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON contract_modifications FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON contract_cancellations FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_transactions FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON month_end_documents FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON accounting_periods FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON transactions FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON fixed_asset_types FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON amortization_schedules FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON journal_entries FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_modifications FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_payment_schedules FOR SELECT TO authenticated
  USING (internal.has_data_access());

CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_payments FOR SELECT TO authenticated
  USING (internal.has_data_access());
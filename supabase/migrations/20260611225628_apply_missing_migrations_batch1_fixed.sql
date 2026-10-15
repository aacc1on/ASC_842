
-- Batch 1: Core function and policy fixes (no dependency on fixed_asset_types)

-- Fix security definer function permissions
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Create is_manage_or_admin (fixes recursive RLS)
CREATE OR REPLACE FUNCTION is_manage_or_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_manage_or_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_manage_or_admin() TO authenticated;

-- Create has_data_access
CREATE OR REPLACE FUNCTION has_data_access()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage', 'view')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.has_data_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_data_access() TO authenticated;

-- Fix get_user_emails_for_admin
CREATE OR REPLACE FUNCTION get_user_emails_for_admin()
RETURNS TABLE (user_id uuid, email text) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid() AND role IN ('admin', 'manage')
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT au.id AS user_id, au.email::text FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_user_emails_for_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;

-- Fix user_profiles policies (drop and recreate cleanly)
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;

CREATE POLICY "Admins can view all profiles" ON user_profiles FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Manage role can view all profiles" ON user_profiles FOR SELECT TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Admins can update all profiles" ON user_profiles FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Manage role can update user profiles" ON user_profiles FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Admins can delete profiles" ON user_profiles FOR DELETE TO authenticated USING (is_admin() AND user_id != auth.uid());

-- Add permissions column to user_profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'permissions') THEN
    ALTER TABLE user_profiles ADD COLUMN permissions jsonb DEFAULT '{
      "view_leases_transactions": true,
      "view_reports_documents": true,
      "create_edit_leases": true,
      "delete_leases": true,
      "create_transactions": true,
      "run_month_end": true,
      "manage_modifications": true,
      "upload_documents": true,
      "manage_user_roles": false,
      "access_user_management": false
    }'::jsonb;
  END IF;
END $$;

-- Shared data access policies (only on tables that exist)
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON leases;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON branches;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON documents;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_modifications;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_cancellations;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_transactions;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON month_end_documents;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON accounting_periods;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON transactions;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON amortization_schedules;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON journal_entries;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_modifications;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payments;

CREATE POLICY "Shared data access for manage and admin roles" ON leases FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON branches FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON documents FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON contract_modifications FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON contract_cancellations FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON lease_transactions FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON month_end_documents FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON accounting_periods FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON transactions FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON amortization_schedules FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON journal_entries FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON lease_modifications FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON lease_payment_schedules FOR SELECT TO authenticated USING (has_data_access());
CREATE POLICY "Shared data access for manage and admin roles" ON lease_payments FOR SELECT TO authenticated USING (has_data_access());

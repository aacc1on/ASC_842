/*
  # Fix recursive RLS on user_profiles for manage role

  1. Problem
    - The "Manage role can view all profiles" and "Manage role can update user profiles" policies
      use inline EXISTS subqueries on user_profiles itself, causing circular RLS evaluation
    - This causes "Failed to load profile" errors for users

  2. Fix
    - Drop the problematic policies that use inline subqueries
    - Replace with policies that use the SECURITY DEFINER function `has_data_access()`
      which bypasses RLS and safely checks role membership

  3. Security
    - Access control remains the same: manage role users can view and update all profiles
    - The function-based approach avoids the circular RLS issue
*/

-- Drop the problematic policies with inline subqueries on user_profiles
DROP POLICY IF EXISTS "Manage role can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON user_profiles;

-- Create a dedicated helper for checking manage/admin role (SECURITY DEFINER bypasses RLS)
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

-- Recreate policies using the safe SECURITY DEFINER function
CREATE POLICY "Manage role can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (is_manage_or_admin());

CREATE POLICY "Manage role can update user profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (is_manage_or_admin())
  WITH CHECK (is_manage_or_admin());

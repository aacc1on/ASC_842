/*
  # Allow manage role to access user management

  1. Modified Functions
    - `get_user_emails_for_admin()` - Now also returns data for users with 'manage' role
    - Renamed internal check to allow manage role users to see user emails

  2. Security Changes
    - Updated RLS policy on `user_profiles` to allow manage role users to view all profiles
    - Added RLS policy allowing manage role users to update user profiles (for role changes)

  3. Important Notes
    - Manage role users can now change other users' roles
    - Manage role users can view all user profiles and emails
    - Admin-exclusive operations (like adding/deleting users) remain admin-only at the application level
*/

-- Update get_user_emails_for_admin to also allow manage role
CREATE OR REPLACE FUNCTION get_user_emails_for_admin()
RETURNS TABLE (user_id uuid, email text) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid() AND role IN ('admin', 'manage')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure execute permissions are correct
REVOKE EXECUTE ON FUNCTION public.get_user_emails_for_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;

-- Allow manage role to view all profiles (if not already covered)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_profiles' AND policyname = 'Manage role can view all profiles'
  ) THEN
    CREATE POLICY "Manage role can view all profiles"
      ON user_profiles FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.user_id = auth.uid() AND up.role = 'manage'
        )
      );
  END IF;
END $$;

-- Allow manage role to update user profiles (for role changes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_profiles' AND policyname = 'Manage role can update user profiles'
  ) THEN
    CREATE POLICY "Manage role can update user profiles"
      ON user_profiles FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.user_id = auth.uid() AND up.role = 'manage'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.user_id = auth.uid() AND up.role = 'manage'
        )
      );
  END IF;
END $$;
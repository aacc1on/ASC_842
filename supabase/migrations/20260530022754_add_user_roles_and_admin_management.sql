/*
  # Add User Roles and Admin Management

  1. Modified Tables
    - `user_profiles`
      - Added `role` column (text) with values: 'admin', 'manage', 'view'
      - Default role is 'view' for new users
      - Added check constraint for valid role values

  2. Security Changes
    - Added RLS policy allowing admins to view all user profiles
    - Added RLS policy allowing admins to update any user profile (for role management)
    - Admin can see all users; manage/view users can only see themselves

  3. Important Notes
    - Roles: 'admin' has full access, 'manage' can create/edit/delete leases, 'view' is read-only
    - The first user (you) should be set to admin manually or via the app
    - Existing users default to 'view' role
*/

-- Add role column to user_profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN role text DEFAULT 'view';
  END IF;
END $$;

-- Add check constraint for valid roles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'user_profiles_role_check'
  ) THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
      CHECK (role IN ('admin', 'manage', 'view'));
  END IF;
END $$;

-- Create a helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Allow admins to view all user profiles
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (is_admin());

-- Allow admins to update any user profile (for role changes)
CREATE POLICY "Admins can update all profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Create index on role for efficient admin queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

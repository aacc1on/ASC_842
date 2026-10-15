/*
  # Add admin delete policy for user profiles

  1. Security Changes
    - Added RLS policy allowing admins to delete other user profiles
    - Admins cannot delete their own profile (enforced in app logic)

  2. Important Notes
    - Only admin users can delete profiles
    - Uses existing is_admin() helper function
*/

-- Allow admins to delete user profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_profiles' AND policyname = 'Admins can delete profiles'
  ) THEN
    CREATE POLICY "Admins can delete profiles"
      ON user_profiles FOR DELETE
      TO authenticated
      USING (is_admin() AND user_id != auth.uid());
  END IF;
END $$;

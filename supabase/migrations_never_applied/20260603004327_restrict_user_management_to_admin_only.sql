/*
  # Restrict user management to admin role only

  1. Changes
    - Drop "Manage role can view all profiles" policy on user_profiles
    - Drop "Manage role can update user profiles" policy on user_profiles
    - Only admins (and individual users for their own profile) can now access user profile data

  2. Security
    - Users with the 'manage' role can no longer view other users' profiles
    - Users with the 'manage' role can no longer modify other users' roles or permissions
    - Admins retain full access via existing "Admins can ..." policies
    - Individual users retain access to their own profile via existing "Users can ... own profile" policies
*/

DROP POLICY IF EXISTS "Manage role can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON public.user_profiles;
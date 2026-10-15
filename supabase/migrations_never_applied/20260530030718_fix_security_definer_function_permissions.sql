/*
  # Fix SECURITY DEFINER Function Permissions

  1. Security Changes
    - Revoke EXECUTE on `is_admin()` from `anon` and `public` roles
    - Revoke EXECUTE on `is_admin(uuid)` from `anon` and `public` roles
    - Revoke EXECUTE on `get_user_emails_for_admin()` from `anon` and `public` roles
    - Grant EXECUTE on `is_admin()` only to `authenticated`
    - Grant EXECUTE on `is_admin(uuid)` only to `authenticated`
    - Grant EXECUTE on `get_user_emails_for_admin()` only to `authenticated`

  2. Important Notes
    - These functions are SECURITY DEFINER and should not be callable by anonymous users
    - `is_admin()` checks if the current user is admin (used in RLS policies)
    - `is_admin(check_user_id uuid)` checks if a given user_id is admin
    - `get_user_emails_for_admin()` returns all user emails (has internal admin check but should not be exposed to anon)
    - Revoking from `public` role removes default grant inherited by all roles
    - Explicit grant to `authenticated` ensures only signed-in users can call these
*/

-- Revoke execute from public (removes default grant) and anon
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_emails_for_admin() FROM public, anon;

-- Grant execute only to authenticated users
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;
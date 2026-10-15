/*
  # Create public wrapper for get_user_emails_for_admin

  1. Problem
    - The frontend calls `supabase.rpc('get_user_emails_for_admin')` but the function
      was moved to the `internal` schema which PostgREST doesn't expose

  2. Fix
    - Create a thin public SECURITY INVOKER wrapper that delegates to the internal function
    - SECURITY INVOKER means it runs with the caller's privileges (safe to expose)
    - The internal function still does its own admin/manage role check

  3. Security
    - The wrapper is NOT SECURITY DEFINER so it's safe to expose via PostgREST
    - Authorization is enforced inside internal.get_user_emails_for_admin()
*/

CREATE OR REPLACE FUNCTION public.get_user_emails_for_admin()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM internal.get_user_emails_for_admin();
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_emails_for_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;
/*
  # Revoke EXECUTE on create_user_profile() from API roles

  ## Issue
  The trigger function `public.create_user_profile()` is `SECURITY DEFINER` and was
  callable via PostgREST (`/rest/v1/rpc/create_user_profile`) by both the `anon`
  and `authenticated` roles. While the function is a trigger function (returns
  TRIGGER) and would error out if invoked directly, it must not be exposed via
  the REST API surface as a SECURITY DEFINER routine.

  ## Change
  1. Revoke EXECUTE on `public.create_user_profile()` from PUBLIC, `anon`, and
     `authenticated`. The trigger on `auth.users` continues to work because
     triggers execute with the function owner's privileges regardless of the
     EXECUTE grant on the function for other roles.

  ## Security
  - Closes the public/authenticated RPC exposure of a SECURITY DEFINER function.
  - No data is touched; only grants are modified.
*/

REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM authenticated;

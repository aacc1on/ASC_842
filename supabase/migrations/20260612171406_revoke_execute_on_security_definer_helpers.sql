-- Revoke direct REST API execution from authenticated/public roles.
-- These are internal helper functions used only by RLS policies, not meant to be called directly.

REVOKE EXECUTE ON FUNCTION public.has_data_access() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.is_manage_or_admin() FROM authenticated, anon, public;

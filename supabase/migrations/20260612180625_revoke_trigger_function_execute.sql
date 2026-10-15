-- Revoke direct REST API execution from trigger functions.
-- These are called only by database triggers, never via /rest/v1/rpc/.

REVOKE EXECUTE ON FUNCTION public.sync_user_profile_email() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM public, anon, authenticated;

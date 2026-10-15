/*
# Revoke PUBLIC/anon EXECUTE on remaining public-schema functions

1. Changes
- `public.get_my_plan()` (SECURITY DEFINER): revoke from PUBLIC and anon.
- `public.get_filtered_transactions(...)` (both overloads, invoker): revoke from PUBLIC and anon.
- `public.get_lease_summary_stats(uuid)` (invoker): revoke from PUBLIC and anon.
- `public.update_updated_at_column()` (trigger): revoke from PUBLIC and anon.
2. Security
- `authenticated` keeps EXECUTE on all of them; the app only calls these after sign-in.
- Trigger functions do not need caller EXECUTE to fire, so triggers are unaffected.
*/
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_my_plan','get_filtered_transactions','get_lease_summary_stats','update_updated_at_column')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
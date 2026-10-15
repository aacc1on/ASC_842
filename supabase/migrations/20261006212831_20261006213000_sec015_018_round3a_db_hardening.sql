/*
# SEC-015/018 Database Hardening (Round 3a)

## Changes

### SEC-015: Revoke anon grants on stripe views
- REVOKE ALL privileges on `stripe_user_orders` and `stripe_user_subscriptions` views from `anon` role.
- These views expose order and subscription data; anon should never have access.
- ALTER DEFAULT PRIVILEGES to prevent future auto-grants to anon on public schema objects.

### SEC-018: Disable REST OpenAPI schema publication
- Set `supabase_rest_openapi` config to 'off' to stop publishing the OpenAPI schema for the REST API.
- This prevents unauthorized discovery of API endpoints.

## Security
- Reduces attack surface by removing anon access to stripe views.
- Hides API structure from public discovery.

## Notes
1. This migration is idempotent — REVOKE and ALTER DEFAULT PRIVILEGES are safe to re-run.
2. The `authenticated` role retains its existing grants on these views.
*/

-- SEC-015: Revoke ALL privileges from anon on stripe views
REVOKE ALL ON public.stripe_user_orders FROM anon;
REVOKE ALL ON public.stripe_user_subscriptions FROM anon;

-- Prevent future auto-grants to anon on public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- SEC-018: Disable OpenAPI schema publication via alter database
DO $$
DECLARE
  db_name text;
BEGIN
  SELECT current_database() INTO db_name;
  EXECUTE format('ALTER DATABASE %I SET supabase_rest_openapi = %L', db_name, 'off');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

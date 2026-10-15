/*
# Store lapsed trials as "expired"

## Plain-English summary
A free trial whose end date has passed used to keep the stored status "trialing" even though access
was already cut off. This migration lets the subscription status be "expired", marks the trials that
have already lapsed, and keeps doing so automatically every hour. Access rules are NOT changed:
internal.org_plan_key and internal.org_has_active_subscription already treat any status other than a
live trial / active / grace-period past_due as expired.

## Modified tables
- `subscriptions.status` check now also allows 'expired'.
- One-time update: rows with status 'trialing' and trial_ends_at in the past become 'expired'
  (status and updated_at only; the existing audit trigger records each change).

## New function
- `internal.expire_lapsed_trials()` returns the number of rows it marked. Not callable by anon or
  authenticated users.

## Modified function
- `public.get_all_users_with_plans()` (platform owner only, guard unchanged) reports a lapsed trial
  as 'expired' even between hourly runs.

## Scheduling
- If the pg_cron extension is available it is enabled and job `expire-lapsed-trials` runs hourly.
  Where it is not available (local test databases) this step is skipped.
*/

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'cancelled'::text, 'expired'::text]));

CREATE OR REPLACE FUNCTION internal.expire_lapsed_trials()
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH expired AS (
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'trialing'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM expired;
$$;

REVOKE ALL ON FUNCTION internal.expire_lapsed_trials() FROM PUBLIC, anon, authenticated;

SELECT internal.expire_lapsed_trials();

CREATE OR REPLACE FUNCTION public.get_all_users_with_plans()
RETURNS TABLE(user_id uuid, email text, full_name text, role text, organization_id uuid, org_name text, plan_key text, plan_status text, trial_ends_at timestamp with time zone, current_period_end timestamp with time zone, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
BEGIN
IF NOT internal.is_platform_admin() THEN
RAISE EXCEPTION 'Platform administrator access required';
END IF;

RETURN QUERY
SELECT
up.user_id,
up.email,
up.full_name,
up.role,
up.organization_id,
o.name AS org_name,
s.plan_key,
CASE WHEN s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= now()
  THEN 'expired' ELSE s.status END AS plan_status,
s.trial_ends_at,
s.current_period_end,
up.created_at
FROM public.user_profiles up
LEFT JOIN public.organizations o ON o.id = up.organization_id
LEFT JOIN LATERAL (
SELECT sub.plan_key, sub.status, sub.trial_ends_at, sub.current_period_end
FROM public.subscriptions sub
WHERE sub.organization_id = up.organization_id
ORDER BY sub.created_at DESC
LIMIT 1
) s ON true
ORDER BY o.name ASC, up.created_at ASC;
END;
$function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      EXECUTE $cron$SELECT cron.schedule('expire-lapsed-trials', '7 * * * *', 'SELECT internal.expire_lapsed_trials()')$cron$;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
    END;
  END IF;
END $$;

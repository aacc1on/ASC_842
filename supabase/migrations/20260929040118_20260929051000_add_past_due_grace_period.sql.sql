/*
# Add past_due 7-day grace period to org_has_active_subscription()

## Changes
- Updates internal.org_has_active_subscription() to also return true when:
  - status = 'past_due' AND current_period_end is within the last 7 days
- This gives users a 7-day grace period after a failed payment before losing access
- Existing trialing and active checks remain unchanged

## Security
- No changes to RLS policies or table structures
- The function is SECURITY DEFINER and STABLE, same as before
*/
CREATE OR REPLACE FUNCTION internal.org_has_active_subscription()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE s.organization_id = internal.current_org_id()
  AND (
    (s.status = 'trialing' AND s.trial_ends_at > now())
    OR
    (s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
    OR
    (s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days')
  )
)
$function$;
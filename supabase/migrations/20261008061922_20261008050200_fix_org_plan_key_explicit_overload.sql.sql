/*
# Fix org_plan_key(target_org_id) and org_has_feature for NULL org

## Changes

### 1. Fix org_plan_key(target_org_id uuid) — remove 'trial' COALESCE fallback
The org-explicit overload still had COALESCE(..., 'trial'). When target_org_id is NULL,
the subquery returns NULL, then COALESCE returns 'trial'. This means
org_has_feature('multi_user', NULL) returns TRUE, granting features to unknown orgs.

Fix: Remove the COALESCE. Return NULL when no subscription found.

### 2. Fix org_has_feature — return FALSE when plan key is NULL
Both overloads of org_has_feature check `org_plan_key() IN ('enterprise', 'trial')`.
When org_plan_key returns NULL, the IN check returns NULL (not TRUE), so the CASE
falls to ELSE FALSE. However, to be explicit and safe, add a NULL guard.
*/

CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
SELECT (
SELECT CASE
WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.plan_key
WHEN s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days' THEN s.plan_key
ELSE NULL
END
FROM public.subscriptions s
WHERE s.organization_id = target_org_id
ORDER BY s.created_at DESC
LIMIT 1
)
$function$;

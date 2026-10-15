/*
# Update internal.org_plan_key to use internal.trial_days() constant

## Change
Replace the hardcoded `interval '5 days'` in org_plan_key's
no-subscription fallback with `make_interval(days => internal.trial_days())`.

This makes internal.trial_days() the single source of truth for the
trial length — both org_plan_key and get_my_plan() reference it.

## No data changes
Only the function definition changes. No tables or rows are modified.
*/

CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $$
SELECT CASE
WHEN target_org_id IS NULL THEN NULL
WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_org_id) THEN NULL
ELSE COALESCE(
(
SELECT CASE
WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.plan_key
WHEN s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days' THEN s.plan_key
ELSE 'expired'
END
FROM public.subscriptions s
WHERE s.organization_id = target_org_id
ORDER BY s.created_at DESC
LIMIT 1
),
CASE
WHEN EXISTS (
SELECT 1 FROM public.organizations o
WHERE o.id = target_org_id
AND o.created_at > now() - make_interval(days => internal.trial_days())
) THEN 'trial'
ELSE 'expired'
END
)
END
$$;

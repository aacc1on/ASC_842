/*
# Fix org_plan_key: expired/cancelled → 'expired', no-row inside trial → 'trial'

## Problem
Version 109 made org_plan_key return 'trial' for ALL expired/cancelled/no-row
orgs, giving expired customers full trial features forever.

## Correct rule (matches src/utils/planFeatures.ts resolvePlanKey)
- active (or trialing with trial_ends_at > now) paid subscription → its plan_key
- no subscription row AND org is inside free-trial period (created_at + 5 days) → 'trial'
- otherwise (trial ended, expired, cancelled, past_due beyond grace) → 'expired'
- NULL org_id → NULL (fail closed)

## Changes
1. Rewrite internal.org_plan_key(target_org_id uuid)
2. Rewrite internal.org_plan_key() (no-args wrapper)
3. Update internal.org_has_active_subscription() to also consider no-row trial
4. Restore Default Organization enterprise subscription
5. Add audit_log entry for the restoration
*/

-- 1. Rewrite org_plan_key(target_org_id uuid)
CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
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
        AND o.created_at > now() - interval '5 days'
      ) THEN 'trial'
      ELSE 'expired'
    END
  )
END
$function$;

-- 2. Rewrite org_plan_key() (no-args wrapper)
CREATE OR REPLACE FUNCTION internal.org_plan_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
SELECT internal.org_plan_key(internal.current_org_id())
$function$;

-- 3. Update org_has_active_subscription() to consider no-row trial
CREATE OR REPLACE FUNCTION internal.org_has_active_subscription()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
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
OR (
  NOT EXISTS (
    SELECT 1 FROM public.subscriptions s WHERE s.organization_id = internal.current_org_id()
  )
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = internal.current_org_id()
    AND o.created_at > now() - interval '5 days'
  )
)
$function$;

-- 4. Restore Default Organization enterprise subscription + audit log
-- Guarded so a fresh (staging) database without this production organization skips it; same effect on production.
DO $$
DECLARE v_sub_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 'bfeffb21-865f-4ba6-b167-c83e473392da'::uuid) THEN
    RETURN;
  END IF;

  INSERT INTO public.subscriptions (organization_id, plan_key, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
  VALUES (
    'bfeffb21-865f-4ba6-b167-c83e473392da'::uuid,
    'enterprise',
    'annually',
    'active',
    NULL,
    '2026-09-28T21:08:35.712422+00:00',
    NULL
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET plan_key = 'enterprise',
      status = 'active',
      billing_cycle = 'annually',
      trial_ends_at = NULL,
      current_period_end = NULL,
      updated_at = now()
  RETURNING id INTO v_sub_id;

  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data)
  VALUES (
    'bfeffb21-865f-4ba6-b167-c83e473392da'::uuid,
    NULL,
    'subscriptions',
    v_sub_id::text,
    'INSERT',
    NULL,
    jsonb_build_object(
      'plan_key', 'enterprise',
      'status', 'active',
      'note', 'Restored by platform owner request - internal platform owner subscription'
    )
  );
END $$;

/*
# Create public.get_my_plan() and internal.trial_days()

## Problem
The frontend (resolvePlanKey in planFeatures.ts) and the database
(internal.org_plan_key) disagree on plan status for orgs with no
subscription row. The frontend returns 'trial' forever when no
subscription exists, while the DB returns 'expired' if the org is
older than 5 days. This means users see features the DB then rejects.

## Fix
1. Create internal.trial_days() returning 5 (the single constant for
   trial length, used by both org_plan_key and get_my_plan).
2. Create public.get_my_plan() (SECURITY DEFINER, search_path set)
   that returns a JSONB object with:
   - plan_key: 'trial', 'expired', 'starter', 'professional', 'enterprise'
   - status: 'trial', 'expired', 'active', 'past_due', 'trialing'
   - trial_ends_at: when the trial ends (from subscription or
     computed from org creation date + trial_days)
   - days_left: days remaining in trial (null if not in trial)
   - features: { contract_modifications, branches, multi_user,
     approval_workflow } computed from org_has_feature
   The function uses the caller's org from auth.uid() →
   user_profiles.organization_id. Platform owner gets full access.
3. Grant EXECUTE to authenticated only.

## Important notes
1. The trial_days() function is the ONE constant.
2. Platform owner (is_platform_admin()) always gets 'enterprise'.
3. No existing data is modified.
*/

-- Step 1: Create internal.trial_days() constant function
CREATE OR REPLACE FUNCTION internal.trial_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5
$$;

-- Step 2: Create public.get_my_plan()
CREATE OR REPLACE FUNCTION public.get_my_plan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_plan_key text;
  v_status text;
  v_trial_ends_at timestamptz;
  v_days_left integer;
  v_is_platform_admin boolean;
BEGIN
  SELECT up.organization_id INTO v_org_id
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid();

  v_is_platform_admin := internal.is_platform_admin();

  IF v_is_platform_admin THEN
    RETURN jsonb_build_object(
      'plan_key', 'enterprise',
      'status', 'active',
      'trial_ends_at', NULL,
      'days_left', NULL,
      'features', jsonb_build_object(
        'contract_modifications', true,
        'branches', true,
        'multi_user', true,
        'approval_workflow', true
      )
    );
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'plan_key', 'expired',
      'status', 'expired',
      'trial_ends_at', NULL,
      'days_left', NULL,
      'features', jsonb_build_object(
        'contract_modifications', false,
        'branches', false,
        'multi_user', false,
        'approval_workflow', false
      )
    );
  END IF;

  v_plan_key := internal.org_plan_key(v_org_id);

  SELECT s.status, s.trial_ends_at INTO v_status, v_trial_ends_at
  FROM public.subscriptions s
  WHERE s.organization_id = v_org_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_trial_ends_at IS NULL AND v_plan_key = 'trial' THEN
    SELECT o.created_at + make_interval(days => internal.trial_days())
    INTO v_trial_ends_at
    FROM public.organizations o
    WHERE o.id = v_org_id;
  END IF;

  IF v_plan_key = 'trial' AND v_trial_ends_at IS NOT NULL THEN
    v_days_left := GREATEST(0, EXTRACT(day FROM v_trial_ends_at - now())::integer);
  ELSE
    v_days_left := NULL;
  END IF;

  IF v_plan_key = 'expired' THEN
    v_status := 'expired';
  ELSIF v_plan_key = 'trial' THEN
    v_status := 'trial';
  END IF;

  RETURN jsonb_build_object(
    'plan_key', v_plan_key,
    'status', COALESCE(v_status, v_plan_key),
    'trial_ends_at', v_trial_ends_at,
    'days_left', v_days_left,
    'features', jsonb_build_object(
      'contract_modifications', internal.org_has_feature('contract_modifications', v_org_id),
      'branches', internal.org_has_feature('branches', v_org_id),
      'multi_user', internal.org_has_feature('multi_user', v_org_id) OR v_plan_key = 'trial',
      'approval_workflow', internal.org_has_feature('approval_workflow', v_org_id) OR v_plan_key = 'trial'
    )
  );
END;
$$;

-- Step 3: Grant execute to authenticated only
REVOKE ALL ON FUNCTION public.get_my_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_plan() TO authenticated;

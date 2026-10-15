/*
# Plan user limits (Enterprise and trial: up to 10 users)

Adds a per-plan maximum number of users and enforces it in the database, so no path (edge function,
direct insert, moving a user between organizations, re-enabling a disabled account) can exceed it.

1. Modified tables
- `subscription_plans`: new column `max_users` (integer, not null, default 1, must be >= 1).
  - starter = 1, professional = 1, enterprise = 10.
  - Enterprise feature text "Multi-user & team roles" becomes "Up to 10 users".
  - The plan audit trigger is paused only around these two plan updates: plans have no organization,
    so the audit log (which requires one) cannot record them. This is the same approach earlier
    plan migrations used.

2. New functions
- `internal.org_max_users(org)`: the limit for an organization. Active trial = 10, expired/none = 1,
  otherwise the plan's `max_users`.
- `internal.org_active_user_count(org, exclude_user)`: users in the org, excluding the platform owner,
  disabled (banned) or deleted accounts, and optionally one user (the one being added).
- `internal.assert_org_user_capacity(org, user)`: takes a per-organization transaction lock, then counts and
  rejects the add if the org is full. The lock makes concurrent adds queue, so two invites at 9 users
  cannot both pass.
- `public.org_user_capacity(p_org)`: { used, max } for the server (service role only), used by edge functions.
- `internal.enforce_org_user_limit_on_move()`: trigger for user_profiles organization changes.
- `internal.enforce_org_user_limit_on_reactivate()`: trigger for auth.users when a disabled account is re-enabled.

3. Modified functions
- `internal.enforce_plan_feature()`: the user_profiles branch now calls assert_org_user_capacity.
- `public.get_my_plan()`: also returns `max_users`, `active_users`, and `over_user_limit`.

4. Security
- No RLS changes. New internal functions are not executable by anon/authenticated;
  `org_user_capacity` is executable by service_role only.

5. Important notes
1. Users are never deleted automatically. Orgs already above their limit (e.g. after a downgrade)
   keep all users, cannot add more, and their admins see a warning.
2. The platform owner never counts toward any organization's limit.
*/

ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_users integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_max_users_positive') THEN
    ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_max_users_positive CHECK (max_users >= 1);
  END IF;
END $$;

ALTER TABLE public.subscription_plans DISABLE TRIGGER audit_log_subscription_plans;

UPDATE public.subscription_plans SET max_users = 1 WHERE plan_key IN ('starter', 'professional') AND max_users <> 1;
UPDATE public.subscription_plans SET max_users = 10 WHERE plan_key = 'enterprise' AND max_users <> 10;

UPDATE public.subscription_plans
SET features = (
  SELECT jsonb_agg(CASE WHEN f = 'Multi-user & team roles' THEN 'Up to 10 users' ELSE f END ORDER BY ord)
  FROM jsonb_array_elements_text(features) WITH ORDINALITY AS t(f, ord)
)
WHERE plan_key = 'enterprise' AND jsonb_typeof(features) = 'array' AND features ? 'Multi-user & team roles';

ALTER TABLE public.subscription_plans ENABLE TRIGGER audit_log_subscription_plans;

CREATE OR REPLACE FUNCTION internal.org_max_users(target_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN k.plan_key = 'trial' THEN 10
    WHEN k.plan_key IS NULL OR k.plan_key = 'expired' THEN 1
    ELSE COALESCE((SELECT sp.max_users FROM public.subscription_plans sp WHERE sp.plan_key = k.plan_key), 1)
  END
  FROM (SELECT internal.org_plan_key(target_org_id) AS plan_key) k
$$;

CREATE OR REPLACE FUNCTION internal.org_active_user_count(target_org_id uuid, exclude_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.user_profiles up
  WHERE up.organization_id = target_org_id
    AND up.user_id IS DISTINCT FROM exclude_user_id
    AND NOT EXISTS (SELECT 1 FROM internal.platform_admins pa WHERE pa.user_id = up.user_id)
    AND NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = up.user_id AND (u.deleted_at IS NOT NULL OR (u.banned_until IS NOT NULL AND u.banned_until > now()))
    )
$$;

CREATE OR REPLACE FUNCTION internal.assert_org_user_capacity(target_org_id uuid, adding_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max integer;
  v_used integer;
BEGIN
  IF target_org_id IS NULL THEN
    RAISE EXCEPTION 'Could not determine the organization for the new user.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM internal.platform_admins pa WHERE pa.user_id = adding_user_id) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('org_user_limit:' || target_org_id::text, 0));

  v_used := internal.org_active_user_count(target_org_id, adding_user_id);
  IF v_used < 1 THEN
    RETURN;
  END IF;

  v_max := internal.org_max_users(target_org_id);
  IF v_used < v_max THEN
    RETURN;
  END IF;

  IF v_max <= 1 THEN
    RAISE EXCEPTION 'Multiple users require the Enterprise plan. Your current plan does not include multi-user access.'
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'Your plan allows up to % users. Remove a user or contact us to add more.', v_max
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION internal.enforce_plan_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
DECLARE
feature_name text;
org_id uuid;
BEGIN
feature_name := CASE TG_TABLE_NAME
WHEN 'contract_modifications' THEN 'contract_modifications'
WHEN 'contract_cancellations' THEN 'contract_modifications'
WHEN 'lease_impairments' THEN 'contract_modifications'
WHEN 'branches' THEN 'branches'
WHEN 'user_profiles' THEN 'multi_user'
ELSE NULL
END;

IF feature_name IS NULL THEN
RETURN NEW;
END IF;

IF feature_name = 'multi_user' THEN
IF TG_OP = 'UPDATE' THEN
RETURN NEW;
END IF;
PERFORM internal.assert_org_user_capacity(NEW.organization_id, NEW.user_id);
RETURN NEW;
END IF;

org_id := (to_jsonb(NEW) ->> 'organization_id')::uuid;

IF org_id IS NULL THEN
RAISE EXCEPTION 'Could not determine your organization for % (your account is not linked to an organization). Please sign in again or contact support.', TG_TABLE_NAME
USING ERRCODE = 'check_violation';
END IF;

IF NOT internal.org_has_feature(feature_name, org_id) THEN
RAISE EXCEPTION '% requires the Professional plan or higher. Your current plan does not include this feature.', feature_name
USING ERRCODE = 'check_violation';
END IF;

RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.enforce_org_user_limit_on_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM internal.assert_org_user_capacity(NEW.organization_id, NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_org_user_limit_on_move ON public.user_profiles;
CREATE TRIGGER enforce_org_user_limit_on_move
  BEFORE UPDATE OF organization_id ON public.user_profiles
  FOR EACH ROW
  WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id AND NEW.organization_id IS NOT NULL)
  EXECUTE FUNCTION internal.enforce_org_user_limit_on_move();

CREATE OR REPLACE FUNCTION internal.enforce_org_user_limit_on_reactivate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.user_profiles WHERE user_id = NEW.id;
  IF v_org IS NOT NULL THEN
    PERFORM internal.assert_org_user_capacity(v_org, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_org_user_limit_on_reactivate ON auth.users;
CREATE TRIGGER enforce_org_user_limit_on_reactivate
  BEFORE UPDATE OF banned_until ON auth.users
  FOR EACH ROW
  WHEN (OLD.banned_until IS NOT NULL AND OLD.banned_until > now()
        AND (NEW.banned_until IS NULL OR NEW.banned_until <= now()))
  EXECUTE FUNCTION internal.enforce_org_user_limit_on_reactivate();

CREATE OR REPLACE FUNCTION public.org_user_capacity(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'used', internal.org_active_user_count(p_org, NULL),
    'max', internal.org_max_users(p_org)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_plan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
DECLARE
v_org_id uuid;
v_plan_key text;
v_status text;
v_trial_ends_at timestamptz;
v_days_left integer;
v_max_users integer;
v_active_users integer;
BEGIN
SELECT up.organization_id INTO v_org_id FROM public.user_profiles up WHERE up.user_id = auth.uid();

IF v_org_id IS NOT NULL THEN
v_active_users := internal.org_active_user_count(v_org_id, NULL);
v_max_users := internal.org_max_users(v_org_id);
ELSE
v_active_users := 0;
v_max_users := 1;
END IF;

IF internal.is_platform_admin() THEN
RETURN jsonb_build_object('plan_key', 'enterprise', 'status', 'active', 'trial_ends_at', NULL, 'days_left', NULL,
'max_users', v_max_users, 'active_users', v_active_users, 'over_user_limit', v_active_users > v_max_users,
'features', jsonb_build_object('contract_modifications', true, 'branches', true, 'multi_user', true));
END IF;

IF v_org_id IS NULL THEN
RETURN jsonb_build_object('plan_key', 'expired', 'status', 'expired', 'trial_ends_at', NULL, 'days_left', NULL,
'max_users', 1, 'active_users', 0, 'over_user_limit', false,
'features', jsonb_build_object('contract_modifications', false, 'branches', false, 'multi_user', false));
END IF;

v_plan_key := internal.org_plan_key(v_org_id);

SELECT s.status, s.trial_ends_at INTO v_status, v_trial_ends_at
FROM public.subscriptions s WHERE s.organization_id = v_org_id ORDER BY s.created_at DESC LIMIT 1;

IF v_trial_ends_at IS NULL AND v_plan_key = 'trial' THEN
SELECT o.created_at + make_interval(days => internal.trial_days()) INTO v_trial_ends_at
FROM public.organizations o WHERE o.id = v_org_id;
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

RETURN jsonb_build_object('plan_key', v_plan_key, 'status', COALESCE(v_status, v_plan_key),
'trial_ends_at', v_trial_ends_at, 'days_left', v_days_left,
'max_users', v_max_users, 'active_users', v_active_users, 'over_user_limit', v_active_users > v_max_users,
'features', jsonb_build_object(
'contract_modifications', internal.org_has_feature('contract_modifications', v_org_id),
'branches', internal.org_has_feature('branches', v_org_id),
'multi_user', internal.org_has_feature('multi_user', v_org_id) OR v_plan_key = 'trial'));
END;
$function$;

REVOKE ALL ON FUNCTION internal.org_max_users(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_active_user_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.assert_org_user_capacity(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_org_user_limit_on_move() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_org_user_limit_on_reactivate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_user_capacity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_user_capacity(uuid) TO service_role;

/*
# Plan Feature Enforcement

## Summary
Enforces the pricing-page feature matrix at the database level so that
tenants on Starter / Professional / Enterprise / Trial can only use the
features their plan promises.  Existing data stays readable; only **new**
writes are blocked when the plan does not include the feature.

## Feature matrix
| Feature              | starter | professional | enterprise | trial |
|----------------------|---------|--------------|------------|-------|
| contract_modifications | no      | yes          | yes        | yes   |
| branches             | no      | yes          | yes        | yes   |
| multi_user           | no      | no           | yes        | no    |

## New helper functions (internal schema)
1. `internal.org_plan_key()` — returns the active subscription's plan_key,
   or `'trial'` when the org has an active trial, or `'trial'` when no
   subscription row exists at all (new orgs behave like trial).
2. `internal.org_has_feature(text)` — convenience wrapper that maps a
   feature name ('contract_modifications' | 'branches' | 'multi_user') to
   a boolean based on the org's plan_key.

## Enforcement mechanism
A single BEFORE INSERT/UPDATE trigger function `internal.enforce_plan_feature()`
is attached to:
- `contract_modifications`  (feature: contract_modifications)
- `contract_cancellations`  (feature: contract_modifications)
- `lease_impairments`       (feature: contract_modifications)
- `branches`                (feature: branches)
- `user_profiles`           (feature: multi_user — only on INSERT, and only
  when the org already has >= 1 user_profile row)

The trigger raises an exception with a clear message when the feature is not
available on the current plan.  The exception text includes the required plan
name so the UI can surface it.

## Important notes
1. SELECT / read access is **unchanged** — existing branches, modifications,
   impairments and extra user rows remain fully readable on every plan.
2. The multi-user check counts existing rows in `user_profiles` for the same
   `organization_id`; the **first** row is always allowed (the account owner),
   a **second** row is blocked unless the org has the `multi_user` feature.
3. The service-role edge functions (recreate-user etc.) bypass RLS but the
   trigger still fires, so the edge function gets the same error unless the
   org is on Enterprise.
4. The existing `subscription_required_*` restrictive policies already block
   writes when there is no active subscription at all.  This migration adds
   a finer-grained check on top of that: even with an active subscription,
   writes to feature-gated tables require the correct plan tier.
*/

-- ─────────────────────────────────────────────
-- 1. internal.org_plan_key()
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION internal.org_plan_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = internal, public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
        WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.plan_key
        WHEN s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days' THEN s.plan_key
        ELSE NULL
      END
      FROM public.subscriptions s
      WHERE s.organization_id = internal.current_org_id()
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'trial'
  )
$$;

GRANT EXECUTE ON FUNCTION internal.org_plan_key() TO authenticated;

-- ─────────────────────────────────────────────
-- 2. internal.org_has_feature(text)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION internal.org_has_feature(feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = internal, public
AS $$
  SELECT CASE
    WHEN internal.org_plan_key() IN ('enterprise') THEN TRUE
    WHEN internal.org_plan_key() IN ('professional', 'trial') AND feature IN ('contract_modifications', 'branches') THEN TRUE
    ELSE FALSE
  END
$$;

GRANT EXECUTE ON FUNCTION internal.org_has_feature(text) TO authenticated;

-- ─────────────────────────────────────────────
-- 3. internal.enforce_plan_feature() trigger function
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION internal.enforce_plan_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public
AS $$
DECLARE
  feature_name text;
  org_id uuid;
  existing_count int;
  required_plan text;
BEGIN
  -- Determine the feature based on the table name
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

  -- For user_profiles, only block INSERT of a second user
  IF feature_name = 'multi_user' THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;

    -- Get the org_id from the new row
    org_id := NEW.organization_id;
    IF org_id IS NULL THEN
      org_id := internal.current_org_id();
    END IF;

    -- Count existing profiles in this org (excluding the row being inserted)
    SELECT count(*) INTO existing_count
    FROM public.user_profiles
    WHERE organization_id = org_id
      AND user_id IS DISTINCT FROM NEW.user_id;

    -- First user is always allowed
    IF existing_count < 1 THEN
      RETURN NEW;
    END IF;

    -- Second+ user requires multi_user feature
    IF NOT internal.org_has_feature('multi_user') THEN
      required_plan := 'Enterprise';
      RAISE EXCEPTION 'Multiple users require the % plan. Your current plan does not include multi-user access.', required_plan
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- For all other feature-gated tables, block INSERT and UPDATE
  IF NOT internal.org_has_feature(feature_name) THEN
    required_plan := CASE feature_name
      WHEN 'contract_modifications' THEN 'Professional'
      WHEN 'branches' THEN 'Professional'
      ELSE 'Professional'
    END;

    RAISE EXCEPTION '% requires the % plan or higher. Your current plan does not include this feature.',
      feature_name, required_plan
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION internal.enforce_plan_feature() TO authenticated;

-- ─────────────────────────────────────────────
-- 4. Attach triggers (idempotent — DROP IF EXISTS first)
-- ─────────────────────────────────────────────

-- contract_modifications
DROP TRIGGER IF EXISTS enforce_plan_feature_contract_modifications ON public.contract_modifications;
CREATE TRIGGER enforce_plan_feature_contract_modifications
  BEFORE INSERT OR UPDATE ON public.contract_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- contract_cancellations
DROP TRIGGER IF EXISTS enforce_plan_feature_contract_cancellations ON public.contract_cancellations;
CREATE TRIGGER enforce_plan_feature_contract_cancellations
  BEFORE INSERT OR UPDATE ON public.contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- lease_impairments
DROP TRIGGER IF EXISTS enforce_plan_feature_lease_impairments ON public.lease_impairments;
CREATE TRIGGER enforce_plan_feature_lease_impairments
  BEFORE INSERT OR UPDATE ON public.lease_impairments
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- branches
DROP TRIGGER IF EXISTS enforce_plan_feature_branches ON public.branches;
CREATE TRIGGER enforce_plan_feature_branches
  BEFORE INSERT OR UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- user_profiles (INSERT only — UPDATE handled by other guards)
DROP TRIGGER IF EXISTS enforce_plan_feature_user_profiles ON public.user_profiles;
CREATE TRIGGER enforce_plan_feature_user_profiles
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

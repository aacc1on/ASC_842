-- Fix: the enforce_plan_feature trigger uses internal.org_has_feature('multi_user')
-- which calls org_plan_key() which calls current_org_id() which uses auth.uid().
-- When the recreate-user edge function (service role, no auth.uid) inserts a
-- user_profiles row, the trigger can't determine the org and defaults to 'trial'.
-- For Enterprise orgs this incorrectly blocked the second user INSERT.
--
-- Solution: add overloads of org_plan_key(uuid) and org_has_feature(text, uuid)
-- that take the organization_id explicitly, and update the trigger to use
-- NEW.organization_id when available.

CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
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
      WHERE s.organization_id = target_org_id
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'trial'
  )
$$;

GRANT EXECUTE ON FUNCTION internal.org_plan_key(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION internal.org_has_feature(feature text, target_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = internal, public
AS $$
  SELECT CASE
    WHEN internal.org_plan_key(target_org_id) IN ('enterprise', 'trial') THEN TRUE
    WHEN internal.org_plan_key(target_org_id) = 'professional' AND feature IN ('contract_modifications', 'branches') THEN TRUE
    WHEN internal.org_plan_key(target_org_id) = 'trial' AND feature IN ('contract_modifications', 'branches') THEN TRUE
    ELSE FALSE
  END
$$;

GRANT EXECUTE ON FUNCTION internal.org_has_feature(text, uuid) TO authenticated;

-- Update the trigger function to use NEW.organization_id when available
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

    org_id := NEW.organization_id;
    IF org_id IS NULL THEN
      org_id := internal.current_org_id();
    END IF;

    SELECT count(*) INTO existing_count
    FROM public.user_profiles
    WHERE organization_id = org_id
      AND user_id IS DISTINCT FROM NEW.user_id;

    IF existing_count < 1 THEN
      RETURN NEW;
    END IF;

    -- Use the org_id-explicit overload so this works with service-role inserts
    IF NOT internal.org_has_feature('multi_user', org_id) THEN
      required_plan := 'Enterprise';
      RAISE EXCEPTION 'Multiple users require the % plan. Your current plan does not include multi-user access.', required_plan
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- For other feature-gated tables, use org_id from NEW if available
  org_id := NULL;
  IF TG_TABLE_NAME IN ('contract_modifications', 'contract_cancellations', 'lease_impairments', 'branches') THEN
    BEGIN
      org_id := (row_to_json(NEW) ->> 'organization_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      org_id := NULL;
    END;
  END IF;

  IF org_id IS NOT NULL THEN
    IF NOT internal.org_has_feature(feature_name, org_id) THEN
      required_plan := CASE feature_name
        WHEN 'contract_modifications' THEN 'Professional'
        WHEN 'branches' THEN 'Professional'
        ELSE 'Professional'
      END;
      RAISE EXCEPTION '% requires the % plan or higher. Your current plan does not include this feature.',
        feature_name, required_plan
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Fall back to auth.uid()-based check
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
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION internal.enforce_plan_feature() TO authenticated;

/*
# Security Fixes Round 5 — Audit Remediation (DDL)

## Changes

### 1. Fix org_plan_key() fallback (High — #21)
Change COALESCE fallback from 'trial' to NULL so service-role context fails closed.

### 2. Fix enforce_plan_feature fallback (Medium — #22)
Remove auth.uid()-based fallback; raise exception when org_id is NULL.

### 3. Revoke EXECUTE on exposed SECURITY DEFINER functions (Medium — #12, #13, #17)

### 4. Add missing FKs on lessors table (Medium — #25)

### 5. Fix companies.organization_id ON DELETE SET NULL → RESTRICT (Medium — #30)
*/

-- 1. Fix org_plan_key() no-arg: fallback to NULL instead of 'trial'
CREATE OR REPLACE FUNCTION internal.org_plan_key()
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
WHERE s.organization_id = internal.current_org_id()
ORDER BY s.created_at DESC
LIMIT 1
)
$function$;

-- 2. Fix enforce_plan_feature: remove auth.uid() fallback, raise when org_id is NULL
CREATE OR REPLACE FUNCTION internal.enforce_plan_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
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
RAISE EXCEPTION 'organization_id is required';
END IF;

SELECT count(*) INTO existing_count
FROM public.user_profiles
WHERE organization_id = org_id
AND user_id IS DISTINCT FROM NEW.user_id;

IF existing_count < 1 THEN
RETURN NEW;
END IF;

IF NOT internal.org_has_feature('multi_user', org_id) THEN
required_plan := 'Enterprise';
RAISE EXCEPTION 'Multiple users require the % plan. Your current plan does not include multi-user access.', required_plan
USING ERRCODE = 'check_violation';
END IF;

RETURN NEW;
END IF;

-- For other feature-gated tables, use org_id from NEW
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
RAISE EXCEPTION 'organization_id is required for feature-gated table %', TG_TABLE_NAME
USING ERRCODE = 'check_violation';
END IF;

RETURN NEW;
END;
$function$;

-- 3. Revoke EXECUTE on exposed SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_all_users_with_plans() FROM authenticated;
REVOKE EXECUTE ON FUNCTION internal.enforce_plan_feature() FROM authenticated;

-- 4. Add missing FKs on lessors table
DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.lessors'::regclass AND conname = 'lessors_organization_id_fkey'
) THEN
  ALTER TABLE public.lessors
    ADD CONSTRAINT lessors_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
END IF;
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.lessors'::regclass AND conname = 'lessors_user_id_fkey'
) THEN
  ALTER TABLE public.lessors
    ADD CONSTRAINT lessors_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF;
END $$;

-- 5. Fix companies.organization_id ON DELETE SET NULL → RESTRICT
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_organization_id_fkey;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

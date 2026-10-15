/*
# Fill organization_id before any other row check runs (all tenant tables)

## Problem
Creating a branch failed with "organization_id is required for feature-gated table branches".
Client inserts omit organization_id and rely on the BEFORE trigger `set_organization_id`
to fill it. PostgreSQL fires BEFORE triggers in alphabetical order of trigger name, so
`aa_approval_workflow` and `enforce_plan_feature_*` ran BEFORE `set_organization_id`
and saw NULL. The plan check fails closed, so the insert was rejected. No table had a
column default. `error_logs` had no fill-in trigger at all, so its RLS insert check
(organization_id = current org) rejected every client error report.

## Changes
1. `internal.set_organization_id()` (shared by every tenant table):
   INSERT -> NEW.organization_id := COALESCE(NEW.organization_id, internal.current_org_id())
   UPDATE -> organization_id may not change.
2. For every public table with an organization_id column, except `user_profiles`
   (membership is assigned by signup/admin functions) and `subscriptions` (billing,
   written by the Stripe webhook):
   - Column DEFAULT internal.current_org_id() (authenticated callers; service-role
     callers must pass organization_id explicitly, as all edge functions already do).
   - Any existing fill-in trigger (set_organization_id, set_lessor_organization_id,
     set_lease_impairments_organization_id) is replaced by one trigger named
     `a00_set_organization_id`. "a00_" sorts before "aa_approval_workflow",
     "enforce_*", "prevent_*", "set_user_id", "validate_*", so it always fires first.
3. `internal.set_lessor_org_id()` (a duplicate of the shared function) is removed.
4. `internal.enforce_plan_feature()` still fails closed when organization_id is NULL
   after that, now with a clear message.
5. service_role may execute internal.current_org_id() (returns NULL for it) so an
   omitted organization_id surfaces as a NOT NULL error instead of a permission error.

## Security
- No RLS policies change. Tenant isolation policies still compare organization_id
  with the caller's organization, so a client-supplied foreign org is still rejected.
- organization_id remains immutable on UPDATE.
*/

CREATE OR REPLACE FUNCTION internal.set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.organization_id := COALESCE(NEW.organization_id, internal.current_org_id());
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'organization_id cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION internal.set_organization_id() FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA internal TO service_role;
GRANT EXECUTE ON FUNCTION internal.current_org_id() TO service_role;

DO $$
DECLARE
  r record;
  trg record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('user_profiles', 'subscriptions')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT internal.current_org_id()', r.table_name);

    FOR trg IN
      SELECT tg.tgname
      FROM pg_trigger tg
      JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE tg.tgrelid = format('public.%I', r.table_name)::regclass
        AND NOT tg.tgisinternal
        AND p.pronamespace = 'internal'::regnamespace
        AND p.proname IN ('set_organization_id', 'set_lessor_org_id')
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg.tgname, r.table_name);
    END LOOP;

    EXECUTE format(
      'CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id()',
      r.table_name
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS internal.set_lessor_org_id();

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

    org_id := NEW.organization_id;
    IF org_id IS NULL THEN
      RAISE EXCEPTION 'Could not determine the organization for the new user.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO existing_count
    FROM public.user_profiles
    WHERE organization_id = org_id
      AND user_id IS DISTINCT FROM NEW.user_id;

    IF existing_count < 1 THEN
      RETURN NEW;
    END IF;

    IF NOT internal.org_has_feature('multi_user', org_id) THEN
      RAISE EXCEPTION 'Multiple users require the Enterprise plan. Your current plan does not include multi-user access.'
        USING ERRCODE = 'check_violation';
    END IF;

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
/*
# Round 3a Database Hardening: SEC-014, SEC-015, SEC-016, SEC-018, QA-002

## SEC-014: Audit triggers on 11 missing business tables
Adds AFTER INSERT/UPDATE/DELETE audit triggers to:
- amortization_schedules, documents, fixed_asset_types, journal_entries,
  lease_impairments, lease_payment_schedules, lease_payments, lessors,
  subscriptions (all have organization_id)
- organizations (id IS the organization_id)
- subscription_plans (global config table — logs with NULL org_id)

The internal.write_audit_log() function is updated to handle:
- organizations: uses NEW.id / OLD.id as organization_id
- subscription_plans: allows NULL organization_id (global table)

## SEC-015: Revoke excessive privileges from anon
- REVOKE ALL on all public tables from anon role
- REVOKE TRUNCATE, TRIGGER, REFERENCES from authenticated on all public tables
- ALTER DEFAULT PRIVILEGES to prevent future over-granting
Note: RLS policies still control data access for authenticated users.
anon no longer has direct table access — all app access is via authenticated sessions.

## SEC-016: NULL-safe enforce_role_permissions_guard
- Uses COALESCE on auth.role() check so NULL auth.role() is treated as
  NOT service_role (safe deny-by-default) instead of NULL (bypasses check)

## SEC-018: Revoke GraphQL/OpenAPI access from anon
- REVOKE USAGE on graphql schema from anon
- This prevents anonymous access to the GraphQL introspection endpoint

## QA-002: CHECK constraints on leases table
- lease_term_months > 0
- payment_amount >= 0
- 0 <= discount_rate < 100 (when not NULL)
- 0 <= incremental_borrowing_rate < 100
- 0 <= implicit_rate < 100 (when not NULL)
- lease_end_date > lease_start_date
- initial_direct_costs >= 0 (when not NULL)
- lease_incentives >= 0 (when not NULL)
- prepaid_lease_payments >= 0
All existing rows verified clean — 0 violations.
*/

-- ============================================================
-- SEC-014: Update write_audit_log to handle organizations and subscription_plans
-- ============================================================

CREATE OR REPLACE FUNCTION internal.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org_id      uuid;
  v_actor       uuid := auth.uid();
  v_record_id   text;
  v_old_json    jsonb;
  v_new_json    jsonb;
  v_changed     text[];
  v_col         text;
  v_old_val     text;
  v_new_val     text;
  v_should_log  boolean := true;
BEGIN
  -- Determine organization_id from the row
  IF TG_TABLE_NAME = 'user_profiles' THEN
    v_org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    -- The id column IS the organization_id
    v_org_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'subscription_plans' THEN
    -- Global config table — no organization_id
    v_org_id := NULL;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_org_id := OLD.organization_id;
    ELSE
      v_org_id := NEW.organization_id;
    END IF;
  END IF;

  -- Skip if no organization (except for global tables like subscription_plans)
  IF v_org_id IS NULL AND TG_TABLE_NAME != 'subscription_plans' THEN
    RETURN NULL;
  END IF;

  -- Determine record_id
  IF TG_OP = 'DELETE' THEN
    v_record_id := (SELECT to_jsonb(OLD) ->> 'id');
    v_old_json  := to_jsonb(OLD);
    v_new_json  := NULL;
    v_changed   := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := (SELECT to_jsonb(NEW) ->> 'id');
    v_old_json  := NULL;
    v_new_json  := to_jsonb(NEW);
    v_changed   := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := (SELECT to_jsonb(NEW) ->> 'id');
    v_old_json  := to_jsonb(OLD);
    v_new_json  := to_jsonb(NEW);

    -- Compute changed columns
    v_changed := '{}';
    FOR v_col IN
      SELECT jsonb_object_keys(v_new_json)
    LOOP
      v_old_val := v_old_json ->> v_col;
      v_new_val := v_new_json ->> v_col;
      IF COALESCE(v_old_val, '') <> COALESCE(v_new_val, '') THEN
        v_changed := array_append(v_changed, v_col);
      END IF;
    END LOOP;

    -- If nothing changed, skip
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NULL;
    END IF;

    -- For user_profiles: only log if role, permissions, or organization_id changed
    IF TG_TABLE_NAME = 'user_profiles' THEN
      v_should_log := (
        v_changed && ARRAY['role','permissions','organization_id']::text[]
      );
      IF NOT v_should_log THEN
        RETURN NULL;
      END IF;
    END IF;

    -- If the only change is updated_at, skip (noise filter)
    IF array_length(v_changed, 1) = 1 AND v_changed[1] = 'updated_at' THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Insert the audit row
  INSERT INTO public.audit_log (
    organization_id,
    actor_user_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_fields
  ) VALUES (
    v_org_id,
    v_actor,
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_old_json,
    v_new_json,
    v_changed
  );

  RETURN NULL;
END;
$function$;

-- ============================================================
-- SEC-014: Add audit triggers to the 11 missing tables
-- ============================================================

-- amortization_schedules
DROP TRIGGER IF EXISTS audit_log_amortization_schedules ON public.amortization_schedules;
CREATE TRIGGER audit_log_amortization_schedules
  AFTER INSERT OR UPDATE OR DELETE ON public.amortization_schedules
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- documents
DROP TRIGGER IF EXISTS audit_log_documents ON public.documents;
CREATE TRIGGER audit_log_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- fixed_asset_types
DROP TRIGGER IF EXISTS audit_log_fixed_asset_types ON public.fixed_asset_types;
CREATE TRIGGER audit_log_fixed_asset_types
  AFTER INSERT OR UPDATE OR DELETE ON public.fixed_asset_types
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- journal_entries
DROP TRIGGER IF EXISTS audit_log_journal_entries ON public.journal_entries;
CREATE TRIGGER audit_log_journal_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lease_impairments
DROP TRIGGER IF EXISTS audit_log_lease_impairments ON public.lease_impairments;
CREATE TRIGGER audit_log_lease_impairments
  AFTER INSERT OR UPDATE OR DELETE ON public.lease_impairments
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lease_payment_schedules
DROP TRIGGER IF EXISTS audit_log_lease_payment_schedules ON public.lease_payment_schedules;
CREATE TRIGGER audit_log_lease_payment_schedules
  AFTER INSERT OR UPDATE OR DELETE ON public.lease_payment_schedules
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lease_payments
DROP TRIGGER IF EXISTS audit_log_lease_payments ON public.lease_payments;
CREATE TRIGGER audit_log_lease_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.lease_payments
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lessors
DROP TRIGGER IF EXISTS audit_log_lessors ON public.lessors;
CREATE TRIGGER audit_log_lessors
  AFTER INSERT OR UPDATE OR DELETE ON public.lessors
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- organizations
DROP TRIGGER IF EXISTS audit_log_organizations ON public.organizations;
CREATE TRIGGER audit_log_organizations
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- subscription_plans
DROP TRIGGER IF EXISTS audit_log_subscription_plans ON public.subscription_plans;
CREATE TRIGGER audit_log_subscription_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- subscriptions
DROP TRIGGER IF EXISTS audit_log_subscriptions ON public.subscriptions;
CREATE TRIGGER audit_log_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- ============================================================
-- SEC-016: NULL-safe enforce_role_permissions_guard
-- ============================================================

CREATE OR REPLACE FUNCTION internal.enforce_role_permissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller_uid uuid := auth.uid();
  -- SEC-016: COALESCE so NULL auth.role() is treated as false (not service_role)
  is_srv_role boolean := COALESCE((SELECT auth.role() = 'service_role'), false);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      IF caller_uid IS NOT NULL AND NOT is_srv_role THEN
        RAISE EXCEPTION 'You do not have permission to change organization_id';
      END IF;
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.permissions IS DISTINCT FROM OLD.permissions) THEN
      IF caller_uid IS NULL THEN
        RETURN NEW;
      END IF;
      IF is_srv_role THEN
        RETURN NEW;
      END IF;
      IF internal.is_admin() THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'You do not have permission to change role or permissions';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF caller_uid IS NOT NULL AND NOT is_srv_role AND NOT internal.is_admin() THEN
      NEW.role := 'view';
      NEW.permissions := '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": false, "access_user_management": false}'::jsonb;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- SEC-015: Revoke excessive privileges from anon and authenticated
-- ============================================================

-- REVOKE ALL privileges from anon on all public tables
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.table_name);
  END LOOP;
END $$;

-- REVOKE TRUNCATE, TRIGGER, REFERENCES from authenticated on all public tables
-- (authenticated should only have SELECT, INSERT, UPDATE, DELETE via RLS policies)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM authenticated', r.table_name);
  END LOOP;
END $$;

-- Set default privileges: future tables should not grant ALL to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- ============================================================
-- SEC-018: Revoke GraphQL/OpenAPI access from anon
-- ============================================================

REVOKE USAGE ON SCHEMA graphql FROM anon;

-- ============================================================
-- QA-002: CHECK constraints on leases table
-- ============================================================

ALTER TABLE public.leases ADD CONSTRAINT leases_lease_term_months_positive CHECK (lease_term_months > 0);
ALTER TABLE public.leases ADD CONSTRAINT leases_payment_amount_nonneg CHECK (payment_amount >= 0);
ALTER TABLE public.leases ADD CONSTRAINT leases_discount_rate_range CHECK (discount_rate IS NULL OR (discount_rate >= 0 AND discount_rate < 100));
ALTER TABLE public.leases ADD CONSTRAINT leases_ibr_range CHECK (incremental_borrowing_rate >= 0 AND incremental_borrowing_rate < 100);
ALTER TABLE public.leases ADD CONSTRAINT leases_implicit_rate_range CHECK (implicit_rate IS NULL OR (implicit_rate >= 0 AND implicit_rate < 100));
ALTER TABLE public.leases ADD CONSTRAINT leases_date_order CHECK (lease_end_date > lease_start_date);
ALTER TABLE public.leases ADD CONSTRAINT leases_initial_direct_costs_nonneg CHECK (initial_direct_costs IS NULL OR initial_direct_costs >= 0);
ALTER TABLE public.leases ADD CONSTRAINT leases_lease_incentives_nonneg CHECK (lease_incentives IS NULL OR lease_incentives >= 0);
ALTER TABLE public.leases ADD CONSTRAINT leases_prepaid_lease_payments_nonneg CHECK (prepaid_lease_payments >= 0);

/*
# Create Audit Log Table and Triggers

## Purpose
Adds an append-only audit trail that records every INSERT, UPDATE, and DELETE
on the core business tables. Each row captures who made the change, which
organization the changed row belongs to, what changed, and when.

## 1. New Tables
- `public.audit_log`
  - `id` bigint identity primary key
  - `organization_id` uuid NOT NULL → references `organizations(id)`
  - `actor_user_id` uuid → the authenticated user who triggered the change (from `auth.uid()`)
  - `table_name` text NOT NULL → name of the table that was changed
  - `record_id` text NOT NULL → primary key of the changed row (cast to text)
  - `action` text NOT NULL, CHECK in ('INSERT','UPDATE','DELETE')
  - `old_data` jsonb → full row before the change (NULL for INSERT)
  - `new_data` jsonb → full row after the change (NULL for DELETE)
  - `changed_fields` text[] → list of column names that changed (NULL unless UPDATE)
  - `created_at` timestamptz NOT NULL default now()

## 2. Indexes
- `(organization_id, created_at DESC)` — most common query pattern
- `(table_name, record_id)` — lookup all changes to a specific record

## 3. Security — RLS
- RLS enabled on `audit_log`.
- SELECT: only admins (`role = 'admin'`) within the same organization.
- No INSERT / UPDATE / DELETE policies for clients — the trigger function
  (SECURITY DEFINER) is the only writer.
- UPDATE, DELETE, TRUNCATE revoked from `anon`, `authenticated`, and `service_role`.
- A BEFORE UPDATE OR DELETE trigger raises an exception if anyone ever
  tries to mutate a row.

## 4. Trigger Function
- `internal.write_audit_log()` — SECURITY DEFINER, SET search_path = ''
- Records `auth.uid()` as the actor.
- For UPDATE: computes the set of changed columns. Skips the row entirely
  if the only changed column is `updated_at` (noise filter).
- For `user_profiles`: only logs changes to `role`, `permissions`, or
  `organization_id` — skips all other column changes.

## 5. Triggers Attached
- `leases` (AFTER INSERT OR UPDATE OR DELETE)
- `lease_transactions` (AFTER INSERT OR UPDATE OR DELETE)
- `transactions` (AFTER INSERT OR UPDATE OR DELETE)
- `lease_modifications` (AFTER INSERT OR UPDATE OR DELETE)
- `contract_modifications` (AFTER INSERT OR UPDATE OR DELETE)
- `contract_cancellations` (AFTER INSERT OR UPDATE OR DELETE)
- `month_end_documents` (AFTER INSERT OR UPDATE OR DELETE)
- `accounting_periods` (AFTER INSERT OR UPDATE OR DELETE)
- `branches` (AFTER INSERT OR UPDATE OR DELETE)
- `companies` (AFTER INSERT OR UPDATE OR DELETE)
- `user_profiles` (AFTER INSERT OR UPDATE OR DELETE)

## 6. Immutability
- `prevent_audit_log_mutation()` BEFORE UPDATE OR DELETE trigger on
  `audit_log` itself — raises an exception on any attempt to modify rows.

## Important Notes
1. No subscription_required policies are added to audit_log.
2. The trigger function uses `to_jsonb(NEW)` / `to_jsonb(OLD)` to capture
   full row state.
3. For UPDATE on user_profiles, the function filters to only log when
   `role`, `permissions`, or `organization_id` changed.
4. All triggers are idempotent (DROP IF EXISTS before CREATE).
5. No existing data is modified or deleted.
*/

-- ============================================================================
-- 1. Create audit_log table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id  uuid,
  table_name     text NOT NULL,
  record_id      text NOT NULL,
  action         text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
  ON public.audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON public.audit_log (table_name, record_id);

-- ============================================================================
-- 3. RLS — admin-only SELECT, no client writes
-- ============================================================================
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (
    organization_id = internal.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role = 'admin'
        AND user_profiles.organization_id = audit_log.organization_id
    )
  );

-- Revoke all write privileges from client roles
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM service_role;

-- ============================================================================
-- 4. Immutability trigger — prevent any mutation of audit rows
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: rows cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS prevent_audit_log_mutation ON public.audit_log;
CREATE TRIGGER prevent_audit_log_mutation
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION internal.prevent_audit_log_mutation();

-- ============================================================================
-- 5. Trigger function — writes audit rows
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_org_id := OLD.organization_id;
    ELSE
      v_org_id := NEW.organization_id;
    END IF;
  END IF;

  -- Skip if no organization (should not happen but be safe)
  IF v_org_id IS NULL THEN
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
$$;

-- ============================================================================
-- 6. Attach triggers to all target tables
-- ============================================================================
-- leases
DROP TRIGGER IF EXISTS audit_log_leases ON public.leases;
CREATE TRIGGER audit_log_leases
  AFTER INSERT OR UPDATE OR DELETE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lease_transactions
DROP TRIGGER IF EXISTS audit_log_lease_transactions ON public.lease_transactions;
CREATE TRIGGER audit_log_lease_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.lease_transactions
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- transactions
DROP TRIGGER IF EXISTS audit_log_transactions ON public.transactions;
CREATE TRIGGER audit_log_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- lease_modifications
DROP TRIGGER IF EXISTS audit_log_lease_modifications ON public.lease_modifications;
CREATE TRIGGER audit_log_lease_modifications
  AFTER INSERT OR UPDATE OR DELETE ON public.lease_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- contract_modifications
DROP TRIGGER IF EXISTS audit_log_contract_modifications ON public.contract_modifications;
CREATE TRIGGER audit_log_contract_modifications
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- contract_cancellations
DROP TRIGGER IF EXISTS audit_log_contract_cancellations ON public.contract_cancellations;
CREATE TRIGGER audit_log_contract_cancellations
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- month_end_documents
DROP TRIGGER IF EXISTS audit_log_month_end_documents ON public.month_end_documents;
CREATE TRIGGER audit_log_month_end_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- accounting_periods
DROP TRIGGER IF EXISTS audit_log_accounting_periods ON public.accounting_periods;
CREATE TRIGGER audit_log_accounting_periods
  AFTER INSERT OR UPDATE OR DELETE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- branches
DROP TRIGGER IF EXISTS audit_log_branches ON public.branches;
CREATE TRIGGER audit_log_branches
  AFTER INSERT OR UPDATE OR DELETE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- companies
DROP TRIGGER IF EXISTS audit_log_companies ON public.companies;
CREATE TRIGGER audit_log_companies
  AFTER INSERT OR UPDATE OR DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- user_profiles
DROP TRIGGER IF EXISTS audit_log_user_profiles ON public.user_profiles;
CREATE TRIGGER audit_log_user_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

/*
# Protect posted accounting data from deletion

## Plain-English summary
An organization, a company or a lease can no longer be deleted while it has posted months
(posted month-end documents or locked accounting periods). This applies to everyone: signed-in
users, the service role, and ad-hoc "cleanup" SQL. Previously every lock trigger stepped aside
when no user was signed in, which let a service-level cleanup remove 81 posted months.

The only way through is a dedicated platform-owner deletion that:
- requires the caller to be a platform admin (internal.is_platform_admin()),
- requires the exact company (or organization) name typed as confirmation,
- writes one audit_log entry ("Platform-owner deletion") with the row counts it removes.

## 1. New tables
- `internal.platform_owner_deletions` — one row per approved override: transaction id, scope
  ('company' | 'organization'), target id, organization id, actor, counts, created_at.
  Lives in the private `internal` schema; no grants to anon, authenticated or service_role, RLS on
  with no policies. Guards accept a delete only when a row exists for the current transaction.

## 2. New functions
- `internal.org_posted_month_count(org)` — distinct posted months (posted/finalized/closed
  month-end documents plus locked/closed accounting periods).
- `internal.platform_owner_delete_active(org)` — true only inside an approved override transaction.
- `internal.protect_posted_data_delete()` — BEFORE DELETE guard on organizations, companies, leases,
  month_end_documents (posted) and accounting_periods (locked/closed).
  Message: "This company has N posted months. Use the platform-owner deletion with confirmation."
- `internal.platform_owner_deletion_counts(scope, target)` — row counts per table.
- `public.platform_owner_deletion_preview(scope, target)` — platform admin only; lists what would go.
- `public.platform_owner_force_delete(scope, target, confirmation)` — platform admin only.
  scope 'company': removes the company's leases (with schedules, entries, transactions,
  modifications, impairments, catch-up batches) and the company. Month-end documents are
  organization-wide and are kept.
  scope 'organization': removes all accounting data of the organization (leases and everything
  under them, month-end documents, accounting periods, catch-up batches, companies, branches,
  lessors, asset types, policy elections). Users, subscriptions, documents, approval settings and
  the audit log are kept; the organization row stays because its audit log is append-only.

## 3. Modified tables
- `audit_log`: action check now also allows 'Platform-owner deletion'.

## 4. Security
- Both public functions: EXECUTE revoked from PUBLIC/anon, granted to authenticated; they refuse
  anyone who is not a platform admin.
- Within the override, request JWT claims are cleared for the rest of that transaction so the
  existing posted-period locks step aside for the approved deletion only.

## 5. Notes
1. No data is changed by this migration.
2. Normal in-app actions keep working: deleting a lease that has no posted periods, and deleting
   the latest posted month-end (signed-in users) are unaffected.
3. Deleting a user whose account owns posted months or a company in an organization with posted
   months now fails instead of silently cascading.
*/

CREATE TABLE IF NOT EXISTS internal.platform_owner_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid bigint NOT NULL,
  scope text NOT NULL CHECK (scope IN ('company', 'organization')),
  target_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_owner_deletions_txid_idx ON internal.platform_owner_deletions (txid, organization_id);
ALTER TABLE internal.platform_owner_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.platform_owner_deletions FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action = ANY (ARRAY[
  'INSERT','UPDATE','DELETE','BACKFILL','REOPEN','Self-approved','Auto-approved (single-user plan)',
  'Approved','Rejected','Auto-approved (approval workflow off)','Catch-up prepared','Catch-up posted',
  'EXPORT','Platform-owner deletion']));

CREATE OR REPLACE FUNCTION internal.org_posted_month_count(p_org uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT count(*)::integer FROM (
    SELECT left(d.period, 7) AS period FROM public.month_end_documents d
    WHERE d.organization_id = p_org AND d.status IN ('posted', 'finalized', 'closed')
    UNION
    SELECT left(ap.period, 7) FROM public.accounting_periods ap
    WHERE ap.organization_id = p_org AND ap.status IN ('locked', 'closed')
  ) m;
$$;

CREATE OR REPLACE FUNCTION internal.platform_owner_delete_active(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal.platform_owner_deletions
    WHERE txid = txid_current() AND organization_id = p_org
  );
$$;

CREATE OR REPLACE FUNCTION internal.protect_posted_data_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_org uuid;
  v_months integer := 0;
  v_subject text;
BEGIN
  v_org := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (to_jsonb(OLD) ->> 'id')::uuid
                ELSE (to_jsonb(OLD) ->> 'organization_id')::uuid END;
  IF v_org IS NULL OR internal.platform_owner_delete_active(v_org) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'leases' THEN
    SELECT count(*) INTO v_months FROM public.accounting_periods ap
    WHERE ap.organization_id = v_org AND ap.status IN ('locked', 'closed')
      AND ap.period_end >= OLD.lease_start_date
      AND ap.period_start <= COALESCE(OLD.lease_end_date, ap.period_start);
    v_subject := 'This lease';
  ELSIF TG_TABLE_NAME = 'month_end_documents' THEN
    -- Signed-in deletes of the latest month are governed by prevent_month_end_mutation.
    IF auth.uid() IS NOT NULL OR OLD.status NOT IN ('posted', 'finalized', 'closed') THEN
      RETURN OLD;
    END IF;
    v_months := internal.org_posted_month_count(v_org);
    v_subject := 'This organization';
  ELSIF TG_TABLE_NAME = 'accounting_periods' THEN
    IF OLD.status NOT IN ('locked', 'closed') THEN
      RETURN OLD;
    END IF;
    v_months := internal.org_posted_month_count(v_org);
    v_subject := 'This organization';
  ELSE
    v_months := internal.org_posted_month_count(v_org);
    v_subject := CASE WHEN TG_TABLE_NAME = 'companies' THEN 'This company' ELSE 'This organization' END;
  END IF;

  IF v_months > 0 THEN
    RAISE EXCEPTION '% has % posted month%. Use the platform-owner deletion with confirmation.',
      v_subject, v_months, CASE WHEN v_months = 1 THEN '' ELSE 's' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_posted_data_delete ON public.organizations;
CREATE TRIGGER protect_posted_data_delete BEFORE DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION internal.protect_posted_data_delete();
DROP TRIGGER IF EXISTS protect_posted_data_delete ON public.companies;
CREATE TRIGGER protect_posted_data_delete BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION internal.protect_posted_data_delete();
DROP TRIGGER IF EXISTS protect_posted_data_delete ON public.leases;
CREATE TRIGGER protect_posted_data_delete BEFORE DELETE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION internal.protect_posted_data_delete();
DROP TRIGGER IF EXISTS protect_posted_data_delete ON public.month_end_documents;
CREATE TRIGGER protect_posted_data_delete BEFORE DELETE ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.protect_posted_data_delete();
DROP TRIGGER IF EXISTS protect_posted_data_delete ON public.accounting_periods;
CREATE TRIGGER protect_posted_data_delete BEFORE DELETE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION internal.protect_posted_data_delete();

CREATE OR REPLACE FUNCTION internal.platform_owner_deletion_counts(p_scope text, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_org uuid;
  v_counts jsonb := '{}'::jsonb;
  v_tbl text;
  v_n bigint;
  v_lease_tables constant text[] := ARRAY['amortization_schedules','journal_entries','transactions',
    'lease_transactions','lease_payment_schedules','lease_payments','lease_modifications',
    'contract_modifications','contract_cancellations','lease_impairments',
    'month_end_catch_up_batches','month_end_catch_up_lines'];
  v_org_tables constant text[] := ARRAY['month_end_documents','accounting_periods',
    'accounting_policy_elections','companies','branches','lessors','fixed_asset_types'];
BEGIN
  IF p_scope = 'company' THEN
    SELECT organization_id INTO v_org FROM public.companies WHERE id = p_target;
    SELECT count(*) INTO v_n FROM public.leases WHERE company_id = p_target;
    v_counts := v_counts || jsonb_build_object('leases', v_n);
    FOREACH v_tbl IN ARRAY v_lease_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE lease_id IN (SELECT id FROM public.leases WHERE company_id = $1)', v_tbl)
        INTO v_n USING p_target;
      v_counts := v_counts || jsonb_build_object(v_tbl, v_n);
    END LOOP;
    SELECT count(*) INTO v_n FROM public.accounting_policy_elections WHERE company_id = p_target;
    v_counts := v_counts || jsonb_build_object('accounting_policy_elections', v_n, 'companies', 1);
  ELSIF p_scope = 'organization' THEN
    v_org := p_target;
    FOREACH v_tbl IN ARRAY ARRAY['leases'] || v_lease_tables || v_org_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', v_tbl) INTO v_n USING p_target;
      v_counts := v_counts || jsonb_build_object(v_tbl, v_n);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Scope must be company or organization.' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'scope', p_scope,
    'target_id', p_target,
    'organization_id', v_org,
    'posted_months', internal.org_posted_month_count(v_org),
    'rows', v_counts);
END;
$$;

CREATE OR REPLACE FUNCTION internal.platform_owner_target_name(p_scope text, p_target uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE p_scope
    WHEN 'company' THEN (SELECT company_name FROM public.companies WHERE id = p_target)
    WHEN 'organization' THEN (SELECT name FROM public.organizations WHERE id = p_target)
  END;
$$;

CREATE OR REPLACE FUNCTION public.platform_owner_deletion_preview(p_scope text, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  v_name := internal.platform_owner_target_name(p_scope, p_target);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nothing found to delete.' USING ERRCODE = 'P0002';
  END IF;
  RETURN internal.platform_owner_deletion_counts(p_scope, p_target) || jsonb_build_object('name', v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_owner_force_delete(p_scope text, p_target uuid, p_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text;
  v_org uuid;
  v_summary jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_tbl text;
BEGIN
  IF v_actor IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('company', 'organization') THEN
    RAISE EXCEPTION 'Scope must be company or organization.' USING ERRCODE = '22023';
  END IF;

  IF p_scope = 'company' THEN
    SELECT company_name, organization_id INTO v_name, v_org FROM public.companies WHERE id = p_target FOR UPDATE;
  ELSE
    SELECT name, id INTO v_name, v_org FROM public.organizations WHERE id = p_target FOR UPDATE;
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nothing found to delete.' USING ERRCODE = 'P0002';
  END IF;
  IF p_confirmation IS NULL OR btrim(p_confirmation) <> btrim(v_name) THEN
    RAISE EXCEPTION 'Confirmation does not match the % name. Type "%" exactly.', p_scope, v_name
      USING ERRCODE = '22023';
  END IF;

  v_summary := internal.platform_owner_deletion_counts(p_scope, p_target) || jsonb_build_object('name', v_name);

  INSERT INTO internal.platform_owner_deletions (txid, scope, target_id, organization_id, actor_user_id, counts)
  VALUES (txid_current(), p_scope, p_target, v_org, v_actor, v_summary);

  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data)
  VALUES (v_org, v_actor, CASE p_scope WHEN 'company' THEN 'companies' ELSE 'organizations' END,
          p_target::text, 'Platform-owner deletion', jsonb_build_object('name', v_name), v_summary);

  -- Lets the existing posted-period locks step aside for this approved transaction only.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF p_scope = 'company' THEN
    DELETE FROM public.month_end_catch_up_lines WHERE lease_id IN (SELECT id FROM public.leases WHERE company_id = p_target);
    DELETE FROM public.month_end_catch_up_batches WHERE lease_id IN (SELECT id FROM public.leases WHERE company_id = p_target);
    DELETE FROM public.lease_impairments WHERE lease_id IN (SELECT id FROM public.leases WHERE company_id = p_target);
    DELETE FROM public.leases WHERE company_id = p_target;
    DELETE FROM public.companies WHERE id = p_target;
  ELSE
    DELETE FROM public.month_end_catch_up_lines WHERE organization_id = v_org;
    DELETE FROM public.month_end_catch_up_batches WHERE organization_id = v_org;
    DELETE FROM public.lease_impairments WHERE organization_id = v_org;
    DELETE FROM public.month_end_documents WHERE organization_id = v_org;
    DELETE FROM public.leases WHERE organization_id = v_org;
    FOREACH v_tbl IN ARRAY ARRAY['journal_entries','amortization_schedules','transactions','lease_transactions',
      'lease_payment_schedules','lease_payments','lease_modifications','contract_modifications',
      'contract_cancellations','accounting_periods','accounting_policy_elections','companies','branches',
      'lessors','fixed_asset_types'] LOOP
      EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1', v_tbl) USING v_org;
    END LOOP;
  END IF;

  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION internal.org_posted_month_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.platform_owner_delete_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.protect_posted_data_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.platform_owner_deletion_counts(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.platform_owner_target_name(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_owner_deletion_preview(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_owner_force_delete(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_owner_deletion_preview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_owner_force_delete(text, uuid, text) TO authenticated;

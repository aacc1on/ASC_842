/*
# Approval module: one setting, one rule, every approval point

## What this does (plain English)
Replaces every older approval branch (trial / single-user / enterprise / plan auto-approve /
require_second_approver) with ONE organization-level setting and ONE database rule shared by
every item that can need approval:
  - accounting policy elections
  - contract modifications
  - contract cancellations
  - lease impairments
  - month-end finalization

Approval OFF (default) or item type not selected -> the item is effective as soon as it is saved:
status approved/posted, approved_by = preparer, approved_at = now, self_approved = true, and an
audit entry "Auto-approved (approval workflow off)".

Approval ON for that type -> item is saved as Pending Approval and does not affect accounting
until approved. Approver must hold the configured approver role (admin, or admin + manage).
If require_different_approver is on, the approver must differ from the preparer; otherwise
self-approval is allowed and recorded (self_approved = true, audit "Self-approved").
The platform owner can always approve. Reject needs a comment and returns the item to Draft.

## New table
- `approval_settings` (one row per organization)
  - organization_id (PK, FK organizations)
  - enabled (bool, default false)
  - require_different_approver (bool, default false)
  - approver_role ('admin' | 'manage', default 'admin')
  - item_types (text[], default all five types)
  - updated_by, updated_at

## Modified tables
- contract_modifications / contract_cancellations: prepared_by, approved_at, self_approved, rejection_comment
- contract_cancellations: status may now also be 'draft' (rejected items return to draft)
- lease_impairments: status, prepared_by, approved_by, approved_at, self_approved, rejection_comment
- month_end_documents: prepared_by, approved_by, approved_at, self_approved, rejection_comment,
  entries (journal lines; posted to transactions by the database when the document is posted)
- accounting_policy_elections: rejection_comment
- audit_log action list: adds 'Approved', 'Rejected', 'Auto-approved (approval workflow off)'

## Functions
- internal.approval_required(org, item_type)
- internal.approval_denial_reason(org, user, item_type, preparer) / internal.can_approve(...)
- internal.apply_approval_workflow() trigger on all five tables (fires first: "aa_approval_workflow")
- internal.post_month_end_entries() posts month-end journal lines when a document becomes 'posted'
- internal.enforce_policy_election_rules() rewritten without any approval branches
- public.get_pending_approvals(), public.check_approval_permission(item_type, item_id)
- public.get_my_plan() no longer reports an approval_workflow plan feature
- public.set_require_second_approver() removed (superseded by approval_settings)

## Security
- RLS on approval_settings: org members read; org admins insert/update their own org row; no delete.
- Settings changes validated (2+ users needed for require_different_approver) and audit-logged.
- New public functions are SECURITY DEFINER, search_path '', EXECUTE for authenticated only.

## Data
- A settings row (enabled = false) is created for every organization, and for new orgs automatically.
- All pending and draft policy elections are auto-approved in version order (audit-logged).
*/

-- ============ 1. Settings table ============
CREATE TABLE IF NOT EXISTS public.approval_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  require_different_approver boolean NOT NULL DEFAULT false,
  approver_role text NOT NULL DEFAULT 'admin',
  item_types text[] NOT NULL DEFAULT ARRAY['policy_election','contract_modification','contract_cancellation','impairment','month_end']::text[],
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_settings_approver_role_check CHECK (approver_role IN ('admin','manage')),
  CONSTRAINT approval_settings_item_types_check CHECK (item_types <@ ARRAY['policy_election','contract_modification','contract_cancellation','impairment','month_end']::text[])
);

ALTER TABLE public.approval_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_approval_settings" ON public.approval_settings;
CREATE POLICY "members_read_approval_settings" ON public.approval_settings FOR SELECT
  TO authenticated USING (organization_id = (SELECT internal.current_org_id()));

DROP POLICY IF EXISTS "admins_insert_approval_settings" ON public.approval_settings;
CREATE POLICY "admins_insert_approval_settings" ON public.approval_settings FOR INSERT
  TO authenticated WITH CHECK (organization_id = (SELECT internal.current_org_id()) AND (SELECT internal.is_admin()));

DROP POLICY IF EXISTS "admins_update_approval_settings" ON public.approval_settings;
CREATE POLICY "admins_update_approval_settings" ON public.approval_settings FOR UPDATE
  TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()) AND (SELECT internal.is_admin()))
  WITH CHECK (organization_id = (SELECT internal.current_org_id()) AND (SELECT internal.is_admin()));

REVOKE ALL ON public.approval_settings FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON public.approval_settings TO authenticated;

-- ============ 2. Columns on approval items ============
ALTER TABLE public.contract_modifications
  ADD COLUMN IF NOT EXISTS prepared_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_comment text;

ALTER TABLE public.contract_cancellations
  ADD COLUMN IF NOT EXISTS prepared_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_comment text;

ALTER TABLE public.lease_impairments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS prepared_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_comment text;
ALTER TABLE public.lease_impairments ALTER COLUMN status SET DEFAULT 'pending_approval';

ALTER TABLE public.month_end_documents
  ADD COLUMN IF NOT EXISTS prepared_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_comment text,
  ADD COLUMN IF NOT EXISTS entries jsonb;

ALTER TABLE public.accounting_policy_elections
  ADD COLUMN IF NOT EXISTS rejection_comment text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lease_impairments_status_check') THEN
    ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_status_check
      CHECK (status IN ('draft','pending_approval','approved'));
  END IF;
END $$;

ALTER TABLE public.contract_cancellations DROP CONSTRAINT IF EXISTS contract_cancellations_status_check;
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_status_check
  CHECK (status IN ('draft','pending_approval','approved','rejected','cancelled'));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'INSERT','UPDATE','DELETE','BACKFILL','Self-approved','Auto-approved (single-user plan)',
  'Approved','Rejected','Auto-approved (approval workflow off)'));

UPDATE public.contract_modifications SET prepared_by = user_id WHERE prepared_by IS NULL;
UPDATE public.contract_cancellations SET prepared_by = user_id WHERE prepared_by IS NULL;
UPDATE public.month_end_documents SET prepared_by = user_id WHERE prepared_by IS NULL;
UPDATE public.lease_impairments li SET prepared_by = l.user_id FROM public.leases l
  WHERE l.id = li.lease_id AND li.prepared_by IS NULL;

-- ============ 3. The one rule ============
CREATE OR REPLACE FUNCTION internal.approval_required(p_org_id uuid, p_item_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.enabled AND p_item_type = ANY (s.item_types)
                   FROM public.approval_settings s WHERE s.organization_id = p_org_id), false)
$$;

CREATE OR REPLACE FUNCTION internal.approval_denial_reason(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_settings public.approval_settings%ROWTYPE;
  v_users int;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'You must be signed in to approve';
  END IF;
  IF EXISTS (SELECT 1 FROM internal.platform_admins pa WHERE pa.user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT up.role INTO v_role FROM public.user_profiles up
  WHERE up.user_id = p_user_id AND up.organization_id = p_org_id;
  IF v_role IS NULL THEN
    RETURN 'You are not a member of this organization';
  END IF;

  IF NOT internal.approval_required(p_org_id, p_item_type) THEN
    IF v_role IN ('admin','manage') THEN RETURN NULL; END IF;
    RETURN 'You do not have permission to change this item';
  END IF;

  SELECT * INTO v_settings FROM public.approval_settings WHERE organization_id = p_org_id;

  IF v_settings.approver_role = 'admin' AND v_role <> 'admin' THEN
    RETURN 'Only administrators can approve this item';
  END IF;
  IF v_settings.approver_role = 'manage' AND v_role NOT IN ('admin','manage') THEN
    RETURN 'Only administrators and managers can approve this item';
  END IF;

  IF v_settings.require_different_approver AND p_preparer_id IS NOT NULL AND p_user_id = p_preparer_id THEN
    SELECT count(*) INTO v_users FROM public.user_profiles WHERE organization_id = p_org_id;
    -- A single remaining user must never be locked out of their own items.
    IF v_users >= 2 THEN
      RETURN 'Segregation of duties: the approver must differ from the preparer';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION internal.can_approve(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT internal.approval_denial_reason(p_org_id, p_user_id, p_item_type, p_preparer_id) IS NULL $$;

-- ============ 4. Shared trigger for every approval item ============
CREATE OR REPLACE FUNCTION internal.apply_approval_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_type text;
  v_pending text := 'pending_approval';
  v_approved text := 'approved';
  v_uid uuid := auth.uid();
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_old_status text;
  v_new_status text;
  v_org uuid;
  v_preparer uuid;
  v_required boolean;
  v_reason text;
  v_patch jsonb := '{}'::jsonb;
  v_action text;
  v_self boolean;
BEGIN
  v_type := CASE TG_TABLE_NAME
    WHEN 'accounting_policy_elections' THEN 'policy_election'
    WHEN 'contract_modifications' THEN 'contract_modification'
    WHEN 'contract_cancellations' THEN 'contract_cancellation'
    WHEN 'lease_impairments' THEN 'impairment'
    WHEN 'month_end_documents' THEN 'month_end'
  END;
  IF v_type = 'month_end' THEN
    v_pending := 'pending';
    v_approved := 'posted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_old_status := v_old->>'status';
  END IF;
  v_new_status := v_new->>'status';
  v_org := COALESCE((v_new->>'organization_id')::uuid, (v_old->>'organization_id')::uuid, internal.current_org_id());

  IF TG_OP = 'INSERT' THEN
    v_preparer := COALESCE(v_uid, (v_new->>'prepared_by')::uuid);
    v_patch := jsonb_build_object('prepared_by', v_preparer, 'approved_by', NULL, 'approved_at', NULL, 'self_approved', false);
  ELSE
    v_preparer := (v_old->>'prepared_by')::uuid;
    IF v_uid IS NOT NULL THEN
      IF (v_new->>'prepared_by') IS DISTINCT FROM (v_old->>'prepared_by') THEN
        RAISE EXCEPTION 'prepared_by cannot be modified';
      END IF;
      v_patch := jsonb_build_object('approved_by', v_old->'approved_by', 'approved_at', v_old->'approved_at',
                                    'self_approved', v_old->'self_approved');
    END IF;
  END IF;

  v_required := internal.approval_required(v_org, v_type);

  IF TG_OP = 'UPDATE' AND v_uid IS NOT NULL AND v_old_status = v_approved
     AND v_new_status IN (v_pending, 'draft') THEN
    RAISE EXCEPTION 'Approved items cannot be returned to pending or draft';
  END IF;

  IF v_new_status IN (v_approved, v_pending)
     AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM v_new_status) THEN

    IF NOT v_required THEN
      v_patch := v_patch || jsonb_build_object('status', v_approved, 'approved_by', v_preparer,
        'approved_at', now(), 'self_approved', true);
      v_action := 'Auto-approved (approval workflow off)';

    ELSIF v_new_status = v_pending THEN
      v_patch := v_patch || jsonb_build_object('status', v_pending);

    ELSIF v_uid IS NULL THEN
      v_patch := v_patch || jsonb_build_object('approved_by', COALESCE((v_new->>'approved_by')::uuid, v_preparer),
        'approved_at', now(), 'self_approved', COALESCE((v_new->>'approved_by')::uuid, v_preparer) = v_preparer);
      v_action := 'Approved';

    ELSIF TG_OP = 'INSERT' THEN
      v_patch := v_patch || jsonb_build_object('status', v_pending);

    ELSIF v_old_status IS DISTINCT FROM v_pending THEN
      RAISE EXCEPTION 'This item must be submitted for approval first';

    ELSE
      v_reason := internal.approval_denial_reason(v_org, v_uid, v_type, v_preparer);
      IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', v_reason;
      END IF;
      v_self := (v_uid = v_preparer);
      v_patch := v_patch || jsonb_build_object('approved_by', v_uid, 'approved_at', now(), 'self_approved', v_self);
      v_action := CASE WHEN v_self THEN 'Self-approved' ELSE 'Approved' END;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND v_old_status = v_pending AND v_new_status IN ('draft','rejected') THEN
    IF COALESCE(btrim(v_new->>'rejection_comment'), '') = '' THEN
      RAISE EXCEPTION 'A comment is required to reject an item';
    END IF;
    IF v_uid IS NOT NULL AND v_required THEN
      v_reason := internal.approval_denial_reason(v_org, v_uid, v_type, NULL);
      IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', replace(v_reason, 'approve', 'reject');
      END IF;
    END IF;
    v_patch := v_patch || jsonb_build_object('status', 'draft');
    v_action := 'Rejected';
  END IF;

  IF v_type = 'month_end' AND TG_OP = 'INSERT' AND COALESCE(v_patch->>'status', v_new_status) = v_approved THEN
    v_patch := v_patch || jsonb_build_object('entries', v_new->'entries');
  END IF;

  NEW := jsonb_populate_record(NEW, v_patch);

  IF v_action IS NOT NULL AND v_org IS NOT NULL THEN
    INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
    VALUES (v_org, v_uid, TG_TABLE_NAME, v_new->>'id', v_action,
      jsonb_build_object('status', v_old_status),
      jsonb_build_object('status', to_jsonb(NEW)->>'status', 'approved_by', to_jsonb(NEW)->>'approved_by',
        'self_approved', to_jsonb(NEW)->'self_approved', 'rejection_comment', to_jsonb(NEW)->>'rejection_comment',
        'platform_owner', EXISTS (SELECT 1 FROM internal.platform_admins pa WHERE pa.user_id = v_uid)),
      ARRAY['status','approved_by','approved_at','self_approved']::text[]);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_approval_workflow ON public.accounting_policy_elections;
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.accounting_policy_elections
  FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();
DROP TRIGGER IF EXISTS aa_approval_workflow ON public.contract_modifications;
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.contract_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();
DROP TRIGGER IF EXISTS aa_approval_workflow ON public.contract_cancellations;
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();
DROP TRIGGER IF EXISTS aa_approval_workflow ON public.lease_impairments;
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.lease_impairments
  FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();
DROP TRIGGER IF EXISTS aa_approval_workflow ON public.month_end_documents;
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- ============ 5. Month-end: post journal lines only once the document is posted ============
CREATE OR REPLACE FUNCTION internal.post_month_end_entries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'posted' AND NEW.entries IS NOT NULL AND jsonb_typeof(NEW.entries) = 'array'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted') THEN
    INSERT INTO public.transactions (user_id, organization_id, lease_id, transaction_date, transaction_type,
      account_debited, account_credited, debit_amount, credit_amount, description, reference_number, period,
      month_end_document_id)
    SELECT NEW.user_id, NEW.organization_id, (e->>'lease_id')::uuid, (e->>'transaction_date')::date,
      e->>'transaction_type', e->>'account_debited', e->>'account_credited',
      (e->>'debit_amount')::numeric, (e->>'credit_amount')::numeric, e->>'description',
      e->>'reference_number', e->>'period', NEW.id
    FROM jsonb_array_elements(NEW.entries) e
    WHERE EXISTS (SELECT 1 FROM public.leases l
                  WHERE l.id = (e->>'lease_id')::uuid AND l.organization_id = NEW.organization_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_month_end_entries ON public.month_end_documents;
CREATE TRIGGER post_month_end_entries AFTER INSERT OR UPDATE OF status ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.post_month_end_entries();

-- ============ 6. Policy election rules without any approval branches ============
CREATE OR REPLACE FUNCTION internal.enforce_policy_election_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_company_entity_type text;
  v_next_version int;
  v_prev_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.prepared_by := auth.uid();
      NEW.prepared_at := now();
      NEW.created_by := auth.uid();
    ELSE
      NEW.prepared_at := COALESCE(NEW.prepared_at, now());
    END IF;

    SELECT COALESCE(MAX(policy_version), 0) + 1 INTO v_next_version
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type;
    NEW.policy_version := v_next_version;
  ELSE
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
    IF NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
      RAISE EXCEPTION 'prepared_at cannot be modified';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by cannot be modified';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at cannot be modified';
    END IF;

    IF OLD.status = 'approved' THEN
      IF NEW.status <> OLD.status AND NEW.status <> 'inactive' THEN
        RAISE EXCEPTION 'Approved policy elections can only be set to inactive';
      END IF;
      IF NEW.status = OLD.status AND (
           NEW.election_value IS DISTINCT FROM OLD.election_value
        OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
        OR NEW.supporting_document_id IS DISTINCT FROM OLD.supporting_document_id
        OR NEW.policy_type IS DISTINCT FROM OLD.policy_type
        OR NEW.fixed_asset_type_id IS DISTINCT FROM OLD.fixed_asset_type_id
        OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
        RAISE EXCEPTION 'Approved policy elections cannot be edited except to set effective_to or change status to inactive';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'approved' AND NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
    SELECT c.entity_type INTO v_company_entity_type FROM public.companies c WHERE c.id = NEW.company_id;
    IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
      RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
    END IF;
  END IF;

  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT id INTO v_prev_id
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type
      AND status = 'approved'
      AND id <> NEW.id
    ORDER BY effective_from DESC, policy_version DESC
    LIMIT 1;
    IF v_prev_id IS NOT NULL THEN
      UPDATE public.accounting_policy_elections
      SET effective_to = (NEW.effective_from - interval '1 day')::date, updated_at = now()
      WHERE id = v_prev_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============ 7. Settings validation + audit ============
CREATE OR REPLACE FUNCTION internal.validate_approval_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF NEW.require_different_approver
     AND (TG_OP = 'INSERT' OR NOT OLD.require_different_approver)
     AND (SELECT count(*) FROM public.user_profiles WHERE organization_id = NEW.organization_id) < 2 THEN
    RAISE EXCEPTION 'A different approver can only be required when the organization has at least 2 active users';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION internal.audit_approval_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.key NOT IN ('updated_at','updated_by')
    AND (TG_OP = 'INSERT' OR n.value IS DISTINCT FROM to_jsonb(OLD)->n.key);
  IF TG_OP = 'UPDATE' AND cardinality(v_changed) = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (NEW.organization_id, auth.uid(), 'approval_settings', NEW.organization_id::text, TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW), v_changed);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS validate_approval_settings ON public.approval_settings;
CREATE TRIGGER validate_approval_settings BEFORE INSERT OR UPDATE ON public.approval_settings
  FOR EACH ROW EXECUTE FUNCTION internal.validate_approval_settings();
DROP TRIGGER IF EXISTS audit_approval_settings ON public.approval_settings;
CREATE TRIGGER audit_approval_settings AFTER INSERT OR UPDATE ON public.approval_settings
  FOR EACH ROW EXECUTE FUNCTION internal.audit_approval_settings();

CREATE OR REPLACE FUNCTION internal.create_default_approval_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.approval_settings (organization_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS create_default_approval_settings ON public.organizations;
CREATE TRIGGER create_default_approval_settings AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION internal.create_default_approval_settings();

-- ============ 8. Public functions for the app ============
CREATE OR REPLACE FUNCTION public.check_approval_permission(p_item_type text, p_item_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_preparer uuid;
  v_status text;
  v_pending text := 'pending_approval';
BEGIN
  IF p_item_type = 'policy_election' THEN
    SELECT organization_id, prepared_by, status INTO v_org, v_preparer, v_status FROM public.accounting_policy_elections WHERE id = p_item_id;
  ELSIF p_item_type = 'contract_modification' THEN
    SELECT organization_id, prepared_by, status INTO v_org, v_preparer, v_status FROM public.contract_modifications WHERE id = p_item_id;
  ELSIF p_item_type = 'contract_cancellation' THEN
    SELECT organization_id, prepared_by, status INTO v_org, v_preparer, v_status FROM public.contract_cancellations WHERE id = p_item_id;
  ELSIF p_item_type = 'impairment' THEN
    SELECT organization_id, prepared_by, status INTO v_org, v_preparer, v_status FROM public.lease_impairments WHERE id = p_item_id;
  ELSIF p_item_type = 'month_end' THEN
    SELECT organization_id, prepared_by, status INTO v_org, v_preparer, v_status FROM public.month_end_documents WHERE id = p_item_id;
    v_pending := 'pending';
  ELSE
    RETURN 'Unknown item type';
  END IF;

  IF v_org IS NULL OR (v_org IS DISTINCT FROM internal.current_org_id() AND NOT internal.is_platform_admin()) THEN
    RETURN 'Item not found';
  END IF;
  IF v_status IS DISTINCT FROM v_pending THEN
    RETURN 'This item is not pending approval';
  END IF;
  RETURN internal.approval_denial_reason(v_org, auth.uid(), p_item_type, v_preparer);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_approvals()
RETURNS TABLE (item_type text, item_id uuid, title text, summary text, amount numeric,
               prepared_by uuid, prepared_by_name text, prepared_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH org AS (SELECT internal.current_org_id() AS id)
  SELECT x.item_type, x.item_id, x.title, x.summary, x.amount, x.prepared_by,
         COALESCE(NULLIF(up.full_name, ''), up.email, 'Unknown user'), x.prepared_at
  FROM (
    SELECT 'policy_election'::text AS item_type, e.id AS item_id,
           COALESCE(f.type_name, 'Asset type') || ' - ' || CASE e.policy_type
             WHEN 'SHORT_TERM_LEASE' THEN 'Short-term lease exemption'
             WHEN 'COMBINE_LEASE_NONLEASE' THEN 'Combine lease and non-lease components'
             ELSE 'Risk-free discount rate' END AS title,
           'v' || e.policy_version || ' - ' || CASE WHEN e.election_value THEN 'Elected' ELSE 'Not elected' END
             || ' - effective ' || to_char(e.effective_from, 'YYYY-MM-DD') AS summary,
           NULL::numeric AS amount, e.prepared_by, COALESCE(e.prepared_at, e.created_at) AS prepared_at
    FROM public.accounting_policy_elections e
    LEFT JOIN public.fixed_asset_types f ON f.id = e.fixed_asset_type_id
    WHERE e.status = 'pending_approval' AND e.organization_id = (SELECT id FROM org)
    UNION ALL
    SELECT 'contract_modification', m.id, COALESCE(l.lease_name, 'Lease') || ' - Modification',
           replace(m.modification_type, '_', ' ') || ' on ' || to_char(m.modification_date, 'YYYY-MM-DD'),
           m.new_monthly_payment, m.prepared_by, m.created_at
    FROM public.contract_modifications m LEFT JOIN public.leases l ON l.id = m.lease_id
    WHERE m.status = 'pending_approval' AND m.organization_id = (SELECT id FROM org)
    UNION ALL
    SELECT 'contract_cancellation', c.id, COALESCE(l.lease_name, 'Lease') || ' - Cancellation',
           'Cancellation on ' || to_char(c.cancellation_date, 'YYYY-MM-DD'),
           c.termination_penalty, c.prepared_by, c.created_at
    FROM public.contract_cancellations c LEFT JOIN public.leases l ON l.id = c.lease_id
    WHERE c.status = 'pending_approval' AND c.organization_id = (SELECT id FROM org)
    UNION ALL
    SELECT 'impairment', i.id, COALESCE(l.lease_name, 'Lease') || ' - Impairment',
           'Impairment on ' || to_char(i.impairment_date, 'YYYY-MM-DD'),
           i.impairment_amount, i.prepared_by, i.created_at
    FROM public.lease_impairments i LEFT JOIN public.leases l ON l.id = i.lease_id
    WHERE i.status = 'pending_approval' AND i.organization_id = (SELECT id FROM org)
    UNION ALL
    SELECT 'month_end', d.id, 'Month-end ' || COALESCE(d.period_label, d.period),
           d.transaction_count || ' journal entries across ' || d.lease_count || ' leases',
           NULL::numeric, d.prepared_by, d.created_at
    FROM public.month_end_documents d
    WHERE d.status = 'pending' AND d.organization_id = (SELECT id FROM org)
  ) x
  LEFT JOIN public.user_profiles up ON up.user_id = x.prepared_by
  ORDER BY x.prepared_at ASC
$$;

REVOKE ALL ON FUNCTION public.check_approval_permission(text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_pending_approvals() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_approval_permission(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_approvals() TO authenticated;

REVOKE ALL ON FUNCTION internal.approval_required(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION internal.approval_denial_reason(uuid, uuid, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION internal.can_approve(uuid, uuid, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION internal.apply_approval_workflow() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION internal.post_month_end_entries() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION internal.validate_approval_settings() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION internal.audit_approval_settings() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION internal.create_default_approval_settings() FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.set_require_second_approver(boolean);

-- ============ 9. Approval is a control setting on every plan ============
CREATE OR REPLACE FUNCTION public.get_my_plan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'internal', 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_plan_key text;
  v_status text;
  v_trial_ends_at timestamptz;
  v_days_left integer;
BEGIN
  SELECT up.organization_id INTO v_org_id FROM public.user_profiles up WHERE up.user_id = auth.uid();

  IF internal.is_platform_admin() THEN
    RETURN jsonb_build_object('plan_key', 'enterprise', 'status', 'active', 'trial_ends_at', NULL, 'days_left', NULL,
      'features', jsonb_build_object('contract_modifications', true, 'branches', true, 'multi_user', true));
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('plan_key', 'expired', 'status', 'expired', 'trial_ends_at', NULL, 'days_left', NULL,
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
    'features', jsonb_build_object(
      'contract_modifications', internal.org_has_feature('contract_modifications', v_org_id),
      'branches', internal.org_has_feature('branches', v_org_id),
      'multi_user', internal.org_has_feature('multi_user', v_org_id) OR v_plan_key = 'trial'));
END;
$function$;

-- ============ 10. Existing data ============
INSERT INTO public.approval_settings (organization_id, require_different_approver)
SELECT o.id, false FROM public.organizations o
ON CONFLICT (organization_id) DO NOTHING;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.accounting_policy_elections
    WHERE status IN ('pending_approval','draft')
    ORDER BY company_id, fixed_asset_type_id, policy_type, policy_version
  LOOP
    UPDATE public.accounting_policy_elections SET status = 'approved' WHERE id = r.id;
  END LOOP;

  UPDATE public.month_end_documents SET status = 'posted' WHERE status = 'pending';
END $$;

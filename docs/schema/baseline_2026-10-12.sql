-- Live schema snapshot of the public and internal schemas, taken 2026-10-12
-- (after migration round_c_database_cleanup). Structure only, no data.
-- Generated from the Postgres catalog. See docs/schema/README.md for how to apply it.

SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS internal;

-- ============ Functions (bodies are not checked until first call) (72) ============

-- internal.apply_approval_workflow()
CREATE OR REPLACE FUNCTION internal.apply_approval_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.approval_denial_reason(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
CREATE OR REPLACE FUNCTION internal.approval_denial_reason(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.approval_required(p_org_id uuid, p_item_type text)
CREATE OR REPLACE FUNCTION internal.approval_required(p_org_id uuid, p_item_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT COALESCE((SELECT s.enabled AND p_item_type = ANY (s.item_types)
FROM public.approval_settings s WHERE s.organization_id = p_org_id), false)
$function$
;

-- internal.audit_approval_settings()
CREATE OR REPLACE FUNCTION internal.audit_approval_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.can_approve(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
CREATE OR REPLACE FUNCTION internal.can_approve(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT internal.approval_denial_reason(p_org_id, p_user_id, p_item_type, p_preparer_id) IS NULL $function$
;

-- internal.create_default_approval_settings()
CREATE OR REPLACE FUNCTION internal.create_default_approval_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
INSERT INTO public.approval_settings (organization_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
RETURN NULL;
END;
$function$
;

-- internal.current_org_id()
CREATE OR REPLACE FUNCTION internal.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT organization_id FROM public.user_profiles WHERE user_id = auth.uid()
$function$
;

-- internal.data_health(p_org uuid)
CREATE OR REPLACE FUNCTION internal.data_health(p_org uuid)
 RETURNS TABLE(organization_id uuid, check_key text, lease_id uuid, lease_name text, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
WITH org_leases AS (
SELECT l.* FROM public.leases l WHERE l.organization_id = p_org
),
last_rows AS (
SELECT DISTINCT ON (a.lease_id) a.lease_id, a.ending_liability, a.rou_asset_balance
FROM public.amortization_schedules a
JOIN org_leases l ON l.id = a.lease_id
ORDER BY a.lease_id, a.period_number DESC
),
ir AS (
SELECT e.lease_id, sum(e.amount) AS amt
FROM public.lease_transactions e
WHERE e.organization_id = p_org AND e.transaction_type = 'initial_recognition'
AND internal.normalize_account(e.account_credited) LIKE '%liabilit%'
GROUP BY e.lease_id
),
modified AS (
SELECT DISTINCT e.lease_id FROM public.lease_transactions e
WHERE e.organization_id = p_org AND e.transaction_type <> 'initial_recognition'
UNION
SELECT DISTINCT c.lease_id FROM public.contract_modifications c WHERE c.organization_id = p_org
)
SELECT p_org, 'lease_without_schedule', l.id, l.lease_name, 'Lease has no amortization schedule rows'
FROM org_leases l
WHERE l.status NOT IN ('draft', 'cancelled')
AND NOT EXISTS (SELECT 1 FROM public.amortization_schedules a WHERE a.lease_id = l.id)
UNION ALL
SELECT p_org, 'schedule_not_ending_at_zero', l.id, l.lease_name,
format('Last schedule row ends at liability %s / ROU %s', round(r.ending_liability, 2), round(r.rou_asset_balance, 2))
FROM last_rows r JOIN org_leases l ON l.id = r.lease_id
WHERE l.status <> 'cancelled'
AND (abs(COALESCE(r.ending_liability, 0)) > 0.01 OR abs(COALESCE(r.rou_asset_balance, 0)) > 0.01)
UNION ALL
SELECT p_org, 'orphan_row', x.lease_id, NULL, format('%s row belongs to a lease in another organization', x.tbl)
FROM (
SELECT 'amortization_schedules' AS tbl, c.lease_id FROM public.amortization_schedules c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'journal_entries', c.lease_id FROM public.journal_entries c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'transactions', c.lease_id FROM public.transactions c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'lease_transactions', c.lease_id FROM public.lease_transactions c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'lease_payment_schedules', c.lease_id FROM public.lease_payment_schedules c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'contract_modifications', c.lease_id FROM public.contract_modifications c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
UNION ALL SELECT 'lease_impairments', c.lease_id FROM public.lease_impairments c JOIN public.leases l ON l.id = c.lease_id
WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
) x
UNION ALL
SELECT p_org, 'unbalanced_journal_entry', j.lease_id, l.lease_name,
format('%s on %s: debits %s, credits %s', j.entry_type, j.entry_date,
round(sum(COALESCE(j.debit_amount, 0)), 2), round(sum(COALESCE(j.credit_amount, 0)), 2))
FROM public.journal_entries j LEFT JOIN public.leases l ON l.id = j.lease_id
WHERE j.organization_id = p_org
GROUP BY j.lease_id, l.lease_name, j.entry_date, j.entry_type
HAVING abs(sum(COALESCE(j.debit_amount, 0)) - sum(COALESCE(j.credit_amount, 0))) > 0.01
UNION ALL
SELECT p_org, 'finance_lease_missing_inputs', l.id, l.lease_name, 'Finance lease is missing fair value or useful life'
FROM org_leases l
WHERE l.lease_classification = 'finance' AND l.status <> 'cancelled'
AND (NOT (COALESCE(l.asset_market_value, 0) > 0 OR COALESCE(l.asset_fair_value, 0) > 0)
OR NOT (COALESCE(l.asset_economic_life_months, 0) > 0))
UNION ALL
SELECT p_org, 'initial_recognition_mismatch', l.id, l.lease_name,
format('Initial recognition %s differs from lease liability %s', round(ir.amt, 2), round(l.lease_liability, 2))
FROM org_leases l JOIN ir ON ir.lease_id = l.id
WHERE l.id NOT IN (SELECT m.lease_id FROM modified m WHERE m.lease_id IS NOT NULL)
AND abs(ir.amt - COALESCE(l.lease_liability, 0)) > 0.01
UNION ALL
SELECT p_org, 'organization_without_owner', NULL, NULL, format('Organization "%s" has no admin user', o.name)
FROM public.organizations o
WHERE o.id = p_org
AND NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.organization_id = o.id AND u.role = 'admin')
UNION ALL
SELECT p_org, 'subscription_without_owner', NULL, NULL, format('Subscription (%s, %s) has no matching user in this organization', s.plan_key, s.status)
FROM public.subscriptions s
WHERE s.organization_id = p_org
AND NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.user_id = s.user_id AND u.organization_id = s.organization_id);
$function$
;

-- internal.enforce_lease_limit()
CREATE OR REPLACE FUNCTION internal.enforce_lease_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_org_id uuid;
v_max_leases int;
v_current_count int;
v_plan_key text;
BEGIN
v_org_id := NEW.organization_id;
IF v_org_id IS NULL THEN
v_org_id := internal.current_org_id();
END IF;

SELECT s.plan_key INTO v_plan_key
FROM public.subscriptions s
WHERE s.organization_id = v_org_id
LIMIT 1;

SELECT sp.max_leases INTO v_max_leases
FROM public.subscription_plans sp
WHERE sp.plan_key = v_plan_key
LIMIT 1;

IF v_max_leases IS NULL THEN
v_max_leases := 50;
END IF;

SELECT count(*) INTO v_current_count
FROM public.leases l
WHERE l.organization_id = v_org_id
AND l.status = 'active'
AND l.id IS DISTINCT FROM NEW.id;

IF v_current_count >= v_max_leases THEN
RAISE EXCEPTION 'Your plan allows up to % active leases. Please upgrade to add more.', v_max_leases;
END IF;

RETURN NEW;
END;
$function$
;

-- internal.enforce_month_end_order()
CREATE OR REPLACE FUNCTION internal.enforce_month_end_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_period_start date;
v_period_end date;
v_earliest date;
v_cursor date;
BEGIN
IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'finalized', 'closed') THEN RETURN NEW; END IF;
IF coalesce(current_setting('app.skip_period_check', true), '') = '1' THEN RETURN NEW; END IF;

v_period_start := to_date(left(NEW.period, 7) || '-01', 'YYYY-MM-DD');
v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

IF current_date <= v_period_end THEN
RAISE EXCEPTION 'Month-end for % can be posted only after the period ends on %.',
to_char(v_period_start, 'FMMonth YYYY'), to_char(v_period_end, 'Mon DD, YYYY');
END IF;

SELECT min(date_trunc('month', l.lease_start_date)::date) INTO v_earliest
FROM public.leases l
WHERE l.organization_id = NEW.organization_id
AND coalesce(l.status, '') <> 'cancelled';

IF v_earliest IS NULL THEN RETURN NEW; END IF;

v_cursor := v_earliest;
WHILE v_cursor < v_period_start LOOP
IF NOT EXISTS (
SELECT 1 FROM public.month_end_documents d
WHERE d.organization_id = NEW.organization_id
AND left(d.period, 7) = to_char(v_cursor, 'YYYY-MM')
AND d.status IN ('posted', 'finalized', 'closed')
AND d.id <> NEW.id
) THEN
RAISE EXCEPTION 'Month-end for % cannot be posted: % has not been posted yet. Post earlier months first.',
to_char(v_period_start, 'FMMonth YYYY'), to_char(v_cursor, 'FMMonth YYYY');
END IF;
v_cursor := (v_cursor + interval '1 month')::date;
END LOOP;

RETURN NEW;
END;
$function$
;

-- internal.enforce_plan_feature()
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
$function$
;

-- internal.enforce_policy_election_rules()
CREATE OR REPLACE FUNCTION internal.enforce_policy_election_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.enforce_role_permissions_guard()
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
$function$
;

-- internal.get_user_emails_for_admin()
CREATE OR REPLACE FUNCTION internal.get_user_emails_for_admin()
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_org_id uuid;
BEGIN
v_org_id := internal.current_org_id();
IF v_org_id IS NULL THEN RETURN; END IF;
IF NOT EXISTS (
SELECT 1 FROM public.user_profiles
WHERE user_profiles.user_id = auth.uid()
AND role IN ('admin', 'manage')
AND organization_id = v_org_id
) THEN RETURN; END IF;

RETURN QUERY
SELECT au.id AS user_id, au.email::text
FROM auth.users au
JOIN public.user_profiles up ON up.user_id = au.id
WHERE up.organization_id = v_org_id;
END;
$function$
;

-- internal.has_data_access()
CREATE OR REPLACE FUNCTION internal.has_data_access()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
RETURN EXISTS (
SELECT 1 FROM public.user_profiles
WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
AND organization_id = internal.current_org_id()
);
END;
$function$
;

-- internal.has_permission(perm_key text)
CREATE OR REPLACE FUNCTION internal.has_permission(perm_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_perms jsonb;
v_role text;
BEGIN
SELECT role, permissions INTO v_role, v_perms
FROM public.user_profiles
WHERE user_id = auth.uid()
AND organization_id = internal.current_org_id();

IF v_role IS NULL THEN
RETURN false;
END IF;

-- Admins always have all permissions
IF v_role = 'admin' THEN
RETURN true;
END IF;

RETURN COALESCE((v_perms ->> perm_key)::boolean, false);
END;
$function$
;

-- internal.is_admin()
CREATE OR REPLACE FUNCTION internal.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
RETURN EXISTS (
SELECT 1 FROM public.user_profiles
WHERE user_id = auth.uid() AND role = 'admin'
AND organization_id = internal.current_org_id()
);
END;
$function$
;

-- internal.is_admin(check_user_id uuid)
CREATE OR REPLACE FUNCTION internal.is_admin(check_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = check_user_id AND role = 'admin'); END;
$function$
;

-- internal.is_manage_or_admin()
CREATE OR REPLACE FUNCTION internal.is_manage_or_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
RETURN EXISTS (
SELECT 1 FROM public.user_profiles
WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
AND organization_id = internal.current_org_id()
);
END;
$function$
;

-- internal.is_platform_admin()
CREATE OR REPLACE FUNCTION internal.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = auth.uid()) $function$
;

-- internal.is_platform_admin_for_user(target_user_id uuid)
CREATE OR REPLACE FUNCTION internal.is_platform_admin_for_user(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = target_user_id) $function$
;

-- internal.lease_balance_as_of(p_lease_id uuid, p_as_of date)
CREATE OR REPLACE FUNCTION internal.lease_balance_as_of(p_lease_id uuid, p_as_of date)
 RETURNS TABLE(rou numeric, liability numeric, status text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'internal'
AS $function$
DECLARE
v_start date;
v_end date;
v_beginning boolean;
v_done amortization_schedules%ROWTYPE;
v_cur amortization_schedules%ROWTYPE;
v_first amortization_schedules%ROWTYPE;
v_max int;
BEGIN
SELECT l.lease_start_date, l.lease_end_date, COALESCE(l.payment_timing, 'end') = 'beginning'
INTO v_start, v_end, v_beginning
FROM leases l WHERE l.id = p_lease_id;
IF NOT FOUND THEN RETURN; END IF;

IF p_as_of < v_start THEN
RETURN QUERY SELECT 0::numeric, 0::numeric, 'not_started'::text; RETURN;
END IF;
IF v_end IS NOT NULL AND p_as_of >= v_end THEN
RETURN QUERY SELECT 0::numeric, 0::numeric, 'ended'::text; RETURN;
END IF;

SELECT max(a.period_number) INTO v_max FROM amortization_schedules a WHERE a.lease_id = p_lease_id;
IF v_max IS NULL THEN
RETURN QUERY SELECT 0::numeric, 0::numeric, 'no_schedule'::text; RETURN;
END IF;

SELECT * INTO v_first FROM amortization_schedules a
WHERE a.lease_id = p_lease_id ORDER BY a.period_number ASC LIMIT 1;

SELECT * INTO v_done FROM amortization_schedules a
WHERE a.lease_id = p_lease_id
AND (date_trunc('month', a.period_date) + interval '1 month - 1 day')::date <= p_as_of
ORDER BY a.period_number DESC LIMIT 1;

IF v_done.id IS NOT NULL AND v_done.period_number >= v_max THEN
RETURN QUERY SELECT 0::numeric, 0::numeric, 'ended'::text; RETURN;
END IF;

SELECT * INTO v_cur FROM amortization_schedules a
WHERE a.lease_id = p_lease_id
AND a.period_date <= p_as_of
AND (date_trunc('month', a.period_date) + interval '1 month - 1 day')::date > p_as_of
ORDER BY a.period_number ASC LIMIT 1;

RETURN QUERY SELECT
COALESCE(v_done.rou_asset_balance, v_first.rou_asset_balance + v_first.depreciation_expense),
CASE
WHEN v_cur.id IS NOT NULL AND v_beginning THEN v_cur.beginning_liability - v_cur.payment_amount
WHEN v_cur.id IS NOT NULL THEN v_cur.beginning_liability
WHEN v_done.id IS NOT NULL THEN v_done.ending_liability
ELSE v_first.beginning_liability
END,
'active'::text;
END;
$function$
;

-- internal.locked_period_status(p_org uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION internal.locked_period_status(p_org uuid, p_from date, p_to date)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT ap.status FROM public.accounting_periods ap
WHERE ap.organization_id = p_org
AND ap.status IN ('locked','closed')
AND ap.period_start <= p_to
AND ap.period_end >= p_from
ORDER BY ap.period_start DESC
LIMIT 1;
$function$
;

-- internal.normalize_account(p text)
CREATE OR REPLACE FUNCTION internal.normalize_account(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ SELECT btrim(replace(lower(COALESCE(p, '')), 'right-of-use', 'rou')) $function$
;

-- internal.org_has_active_subscription()
CREATE OR REPLACE FUNCTION internal.org_has_active_subscription()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$
SELECT EXISTS (
SELECT 1 FROM public.subscriptions s
WHERE s.organization_id = internal.current_org_id()
AND (
(s.status = 'trialing' AND s.trial_ends_at > now())
OR
(s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
OR
(s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days')
)
)
OR (
NOT EXISTS (
SELECT 1 FROM public.subscriptions s WHERE s.organization_id = internal.current_org_id()
)
AND EXISTS (
SELECT 1 FROM public.organizations o
WHERE o.id = internal.current_org_id()
AND o.created_at > now() - interval '5 days'
)
)
$function$
;

-- internal.org_has_feature(feature text)
CREATE OR REPLACE FUNCTION internal.org_has_feature(feature text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT CASE
WHEN internal.org_plan_key() IN ('enterprise', 'trial') THEN TRUE
WHEN internal.org_plan_key() = 'professional' AND feature IN ('contract_modifications', 'branches') THEN TRUE
WHEN internal.org_plan_key() = 'trial' AND feature IN ('contract_modifications', 'branches') THEN TRUE
ELSE FALSE
END
$function$
;

-- internal.org_has_feature(feature text, target_org_id uuid)
CREATE OR REPLACE FUNCTION internal.org_has_feature(feature text, target_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT CASE
WHEN internal.org_plan_key(target_org_id) IN ('enterprise', 'trial') THEN TRUE
WHEN internal.org_plan_key(target_org_id) = 'professional' AND feature IN ('contract_modifications', 'branches') THEN TRUE
WHEN internal.org_plan_key(target_org_id) = 'trial' AND feature IN ('contract_modifications', 'branches') THEN TRUE
ELSE FALSE
END
$function$
;

-- internal.org_plan_key()
CREATE OR REPLACE FUNCTION internal.org_plan_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$
SELECT internal.org_plan_key(internal.current_org_id())
$function$
;

-- internal.org_plan_key(target_org_id uuid)
CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$
SELECT CASE
WHEN target_org_id IS NULL THEN NULL
WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_org_id) THEN NULL
ELSE COALESCE(
(
SELECT CASE
WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.plan_key
WHEN s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days' THEN s.plan_key
ELSE 'expired'
END
FROM public.subscriptions s
WHERE s.organization_id = target_org_id
ORDER BY s.created_at DESC
LIMIT 1
),
CASE
WHEN EXISTS (
SELECT 1 FROM public.organizations o
WHERE o.id = target_org_id
AND o.created_at > now() - make_interval(days => internal.trial_days())
) THEN 'trial'
ELSE 'expired'
END
)
END
$function$
;

-- internal.post_month_end_entries()
CREATE OR REPLACE FUNCTION internal.post_month_end_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.prevent_audit_log_mutation()
CREATE OR REPLACE FUNCTION internal.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
RAISE EXCEPTION 'audit_log is append-only: rows cannot be modified or deleted';
END;
$function$
;

-- internal.prevent_delete_posted_contract_change()
CREATE OR REPLACE FUNCTION internal.prevent_delete_posted_contract_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_posted boolean;
BEGIN
IF TG_TABLE_NAME = 'contract_modifications' THEN
v_posted := COALESCE((to_jsonb(OLD)->>'accounting_posted')::boolean, false);
ELSE
v_posted := COALESCE((to_jsonb(OLD)->>'derecognition_posted')::boolean, false);
END IF;

IF v_posted AND EXISTS (SELECT 1 FROM public.leases WHERE id = OLD.lease_id) THEN
RAISE EXCEPTION 'This item has already been posted to the books and cannot be deleted. Record a new modification to adjust it instead.'
USING ERRCODE = 'P0001';
END IF;

RETURN OLD;
END;
$function$
;

-- internal.prevent_locked_amortization_mutation()
CREATE OR REPLACE FUNCTION internal.prevent_locked_amortization_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_status text;
BEGIN
IF auth.uid() IS NOT NULL THEN
v_status := internal.locked_period_status(OLD.organization_id, OLD.period_date, OLD.period_date);
IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
v_status := internal.locked_period_status(OLD.organization_id, NEW.period_date, NEW.period_date);
END IF;
IF v_status IS NOT NULL THEN
RAISE EXCEPTION 'Cannot change the amortization schedule for %: that month is posted (%). Use Contract Modification instead.',
to_char(OLD.period_date, 'FMMonth YYYY'), v_status;
END IF;
END IF;
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_locked_payment_schedule_mutation()
CREATE OR REPLACE FUNCTION internal.prevent_locked_payment_schedule_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_lease_start date;
v_from date;
v_to date;
v_status text;
BEGIN
IF auth.uid() IS NOT NULL THEN
SELECT l.lease_start_date INTO v_lease_start FROM public.leases l WHERE l.id = OLD.lease_id;
IF v_lease_start IS NOT NULL THEN
v_from := (v_lease_start + make_interval(months => GREATEST(OLD.from_month, 1) - 1))::date;
v_to := (v_lease_start + make_interval(months => GREATEST(OLD.to_month, OLD.from_month, 1)) - interval '1 day')::date;
v_status := internal.locked_period_status(OLD.organization_id, v_from, v_to);
IF v_status IS NOT NULL THEN
RAISE EXCEPTION 'Cannot change payment schedule months %-%: they include posted periods. Use Contract Modification instead.',
OLD.from_month, OLD.to_month;
END IF;
END IF;
END IF;
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_month_end_mutation()
CREATE OR REPLACE FUNCTION internal.prevent_month_end_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_skip text;
v_latest text;
BEGIN
v_skip := current_setting('app.skip_period_check', true);
IF v_skip = '1' OR auth.uid() IS NULL THEN
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END IF;

IF OLD.status IN ('finalized', 'closed') THEN
RAISE EXCEPTION 'Cannot modify a finalized or closed month-end document. Use the reopen function.';
END IF;

IF TG_OP = 'DELETE' THEN
IF OLD.status IN ('posted', 'finalized', 'closed') THEN
SELECT max(period) INTO v_latest FROM month_end_documents
WHERE organization_id = OLD.organization_id AND status IN ('posted', 'finalized', 'closed');
IF v_latest IS NOT NULL AND OLD.period < v_latest THEN
RAISE EXCEPTION 'Remove later months first (latest posted: %)',
to_char(to_date(v_latest || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
END IF;
END IF;
RETURN OLD;
END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_period_locked_mutation_je()
CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_status text;
BEGIN
IF auth.uid() IS NOT NULL THEN
v_status := internal.locked_period_status(OLD.organization_id, OLD.entry_date, OLD.entry_date);
IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
v_status := internal.locked_period_status(OLD.organization_id, NEW.entry_date, NEW.entry_date);
END IF;
IF v_status IS NOT NULL THEN
RAISE EXCEPTION 'Cannot modify journal entries in a % accounting period', v_status;
END IF;
END IF;
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_period_locked_mutation_lt()
CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_lt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_status text;
BEGIN
IF auth.uid() IS NOT NULL THEN
v_status := internal.locked_period_status(OLD.organization_id, OLD.transaction_date, OLD.transaction_date);
IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
v_status := internal.locked_period_status(OLD.organization_id, NEW.transaction_date, NEW.transaction_date);
END IF;
IF v_status IS NOT NULL THEN
RAISE EXCEPTION 'Cannot modify lease transactions in a % accounting period', v_status;
END IF;
END IF;
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_posted_lease_delete()
CREATE OR REPLACE FUNCTION internal.prevent_posted_lease_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_through date;
BEGIN
IF auth.uid() IS NOT NULL THEN
v_through := public.get_lease_posted_through(OLD.id);
IF v_through IS NOT NULL THEN
RAISE EXCEPTION 'This lease has posted periods (posted through %) and cannot be deleted. Record a cancellation in Contract Modification instead.',
to_char(v_through, 'FMMonth YYYY');
END IF;
END IF;
RETURN OLD;
END;
$function$
;

-- internal.prevent_posted_transaction_mutation()
CREATE OR REPLACE FUNCTION internal.prevent_posted_transaction_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_doc_status text;
BEGIN
IF auth.uid() IS NULL OR coalesce(current_setting('app.skip_period_check', true), '') = '1' THEN
IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END IF;

SELECT med.status INTO v_doc_status
FROM public.month_end_documents med
WHERE med.id = COALESCE(OLD.month_end_document_id, NEW.month_end_document_id);

IF v_doc_status IN ('posted', 'finalized', 'closed') THEN
RAISE EXCEPTION 'Cannot modify a transaction that belongs to a posted month-end. Remove later months first, then delete that month-end.';
END IF;

IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_user_id_change()
CREATE OR REPLACE FUNCTION internal.prevent_user_id_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
RAISE EXCEPTION 'user_id cannot be changed';
END IF;
RETURN NEW;
END;
$function$
;

-- internal.prevent_zero_amount_recognition()
CREATE OR REPLACE FUNCTION internal.prevent_zero_amount_recognition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
IF NEW.transaction_type = 'initial_recognition' AND ROUND(NEW.amount::numeric, 2) = 0.00 THEN
RAISE EXCEPTION 'Initial recognition entries must have a non-zero amount. The lease liability rounds to zero — no recognition entry is created.';
END IF;
RETURN NEW;
END;
$function$
;

-- internal.reconcile_ledgers(p_org uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION internal.reconcile_ledgers(p_org uuid, p_from date, p_to date)
 RETURNS TABLE(check_type text, lease_id uuid, lease_name text, period text, account text, posted numeric, expected numeric, difference numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
WITH locked AS (
SELECT ap.period
FROM public.accounting_periods ap
WHERE ap.organization_id = p_org
AND ap.status IN ('locked', 'closed')
AND ap.period_start >= date_trunc('month', p_from)::date
AND ap.period_end <= p_to
),
event_types AS (
SELECT unnest(ARRAY['Initial Recognition', 'Lease Modification', 'Lease Cancellation', 'Lease Impairment', 'Lease Termination']) AS t
),
posted AS (
SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
SELECT t.lease_id, t.period, internal.normalize_account(t.account_debited) AS acct, COALESCE(t.debit_amount, 0) AS amt
FROM public.transactions t
WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked) AND t.account_debited IS NOT NULL
UNION ALL
SELECT t.lease_id, t.period, internal.normalize_account(t.account_credited), -COALESCE(t.credit_amount, 0)
FROM public.transactions t
WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked) AND t.account_credited IS NOT NULL
) x GROUP BY 1, 2, 3
),
je_periodic AS (
SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
FROM public.journal_entries j
WHERE j.organization_id = p_org
AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
AND j.entry_type NOT IN (SELECT t FROM event_types)
GROUP BY 1, 2, 3
),
events AS (
SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM') AS period, internal.normalize_account(e.account_debited) AS acct, COALESCE(e.amount, 0) AS amt
FROM public.lease_transactions e
WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT period FROM locked)
UNION ALL
SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM'), internal.normalize_account(e.account_credited), -COALESCE(e.amount, 0)
FROM public.lease_transactions e
WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT period FROM locked)
) x GROUP BY 1, 2, 3
),
je_events AS (
SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
FROM public.journal_entries j
WHERE j.organization_id = p_org
AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
AND j.entry_type IN (SELECT t FROM event_types)
GROUP BY 1, 2, 3
),
diffs AS (
SELECT 'posted_vs_journal'::text AS check_type, COALESCE(p.lease_id, j.lease_id) AS lease_id,
COALESCE(p.period, j.period) AS period, COALESCE(p.acct, j.acct) AS account,
round(COALESCE(p.amt, 0), 2) AS posted, round(COALESCE(j.amt, 0), 2) AS expected
FROM posted p
FULL JOIN je_periodic j ON j.lease_id IS NOT DISTINCT FROM p.lease_id AND j.period = p.period AND j.acct = p.acct
UNION ALL
SELECT 'events_vs_journal', COALESCE(e.lease_id, j.lease_id), COALESCE(e.period, j.period), COALESCE(e.acct, j.acct),
round(COALESCE(e.amt, 0), 2), round(COALESCE(j.amt, 0), 2)
FROM events e
FULL JOIN je_events j ON j.lease_id IS NOT DISTINCT FROM e.lease_id AND j.period = e.period AND j.acct = e.acct
),
unbalanced AS (
SELECT 'unbalanced_journal_entry'::text AS check_type, j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period,
j.entry_type AS account,
round(sum(COALESCE(j.debit_amount, 0)), 2) AS posted, round(sum(COALESCE(j.credit_amount, 0)), 2) AS expected
FROM public.journal_entries j
WHERE j.organization_id = p_org AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
GROUP BY j.lease_id, j.entry_date, j.entry_type
HAVING abs(sum(COALESCE(j.debit_amount, 0)) - sum(COALESCE(j.credit_amount, 0))) > 0.01
UNION ALL
SELECT 'unbalanced_posted_entry', t.lease_id, t.period, COALESCE(t.transaction_type, ''),
round(sum(COALESCE(t.debit_amount, 0)), 2), round(sum(COALESCE(t.credit_amount, 0)), 2)
FROM public.transactions t
WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked)
GROUP BY t.lease_id, t.period, t.transaction_type
HAVING abs(sum(COALESCE(t.debit_amount, 0)) - sum(COALESCE(t.credit_amount, 0))) > 0.01
)
SELECT r.check_type, r.lease_id, l.lease_name, r.period, r.account, r.posted, r.expected, round(r.posted - r.expected, 2)
FROM (
SELECT d.* FROM diffs d
WHERE abs(d.posted - d.expected) > 0.01
AND (
(d.check_type = 'posted_vs_journal' AND EXISTS (
SELECT 1 FROM je_periodic j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
OR (d.check_type = 'events_vs_journal' AND EXISTS (
SELECT 1 FROM je_events j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
)
UNION ALL
SELECT * FROM unbalanced
) r
LEFT JOIN public.leases l ON l.id = r.lease_id
ORDER BY r.period, l.lease_name, r.check_type, r.account;
$function$
;

-- internal.require_finance_classification_inputs()
CREATE OR REPLACE FUNCTION internal.require_finance_classification_inputs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
IF NEW.lease_classification <> 'finance'
OR COALESCE(NEW.accounting_treatment, 'recognized') = 'short_term_exemption' THEN
RETURN NEW;
END IF;

IF TG_OP = 'UPDATE'
AND COALESCE(current_setting('app.saving_lease', true), '') <> 'on'
AND NEW.lease_classification IS NOT DISTINCT FROM OLD.lease_classification
AND NEW.asset_market_value IS NOT DISTINCT FROM OLD.asset_market_value
AND NEW.asset_economic_life_months IS NOT DISTINCT FROM OLD.asset_economic_life_months THEN
RETURN NEW;
END IF;

IF COALESCE(NEW.asset_market_value, 0) <= 0 OR COALESCE(NEW.asset_economic_life_months, 0) <= 0 THEN
RAISE EXCEPTION 'Finance classification requires the asset''s fair value and useful life';
END IF;

RETURN NEW;
END;
$function$
;

-- internal.set_organization_id()
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
$function$
;

-- internal.set_user_id()
CREATE OR REPLACE FUNCTION internal.set_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
-- Force user_id from session for non-service callers.
-- The service role bypasses RLS and has auth.uid() = NULL.
IF auth.uid() IS NOT NULL THEN
NEW.user_id := auth.uid();
END IF;
RETURN NEW;
END;
$function$
;

-- internal.sync_accounting_period_lock()
CREATE OR REPLACE FUNCTION internal.sync_accounting_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_posted constant text[] := ARRAY['posted','finalized','closed'];
v_doc public.month_end_documents;
v_lock boolean;
v_start date;
BEGIN
IF TG_OP = 'DELETE' THEN
v_doc := OLD;
v_lock := NULL;
IF OLD.status = ANY (v_posted) THEN v_lock := false; END IF;
ELSIF TG_OP = 'INSERT' THEN
v_doc := NEW;
v_lock := CASE WHEN NEW.status = ANY (v_posted) THEN true END;
ELSE
v_doc := NEW;
IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
RETURN NULL;
ELSIF OLD.status IN ('finalized','closed') AND NEW.status = 'posted' THEN
v_lock := false;
ELSIF NEW.status = ANY (v_posted) THEN
v_lock := true;
ELSIF OLD.status = ANY (v_posted) THEN
v_lock := false;
END IF;
END IF;

IF v_lock IS NULL THEN
RETURN NULL;
END IF;

v_start := to_date(left(v_doc.period, 7) || '-01', 'YYYY-MM-DD');

IF v_lock THEN
INSERT INTO public.accounting_periods
(organization_id, user_id, period, period_start, period_end, status, closed_at, closed_by)
VALUES
(v_doc.organization_id, v_doc.user_id, left(v_doc.period, 7), v_start,
(v_start + interval '1 month' - interval '1 day')::date, 'locked', now(),
COALESCE(auth.uid(), v_doc.user_id)::text)
ON CONFLICT (organization_id, period) DO UPDATE
SET status = 'locked', closed_at = now(), closed_by = EXCLUDED.closed_by;
ELSE
UPDATE public.accounting_periods
SET status = 'open', closed_at = NULL
WHERE organization_id = v_doc.organization_id AND period = left(v_doc.period, 7);
END IF;
RETURN NULL;
END;
$function$
;

-- internal.trial_days()
CREATE OR REPLACE FUNCTION internal.trial_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
SELECT 5
$function$
;

-- internal.validate_approval_settings()
CREATE OR REPLACE FUNCTION internal.validate_approval_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- internal.write_audit_log()
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
$function$
;

-- public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb)
CREATE OR REPLACE FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_caller uuid := auth.uid();
v_caller_org uuid;
v_target_org uuid;
v_admin_count int;
BEGIN
IF v_caller IS NULL THEN
RAISE EXCEPTION 'Not authorized to change roles';
END IF;

IF new_role NOT IN ('admin', 'manage', 'view') THEN
RAISE EXCEPTION 'Invalid role';
END IF;

IF target_user_id = v_caller THEN
RAISE EXCEPTION 'You cannot change your own role';
END IF;

SELECT organization_id INTO v_caller_org
FROM public.user_profiles
WHERE user_id = v_caller AND role = 'admin';

IF v_caller_org IS NULL THEN
RAISE EXCEPTION 'Not authorized to change roles';
END IF;

SELECT organization_id INTO v_target_org
FROM public.user_profiles
WHERE user_id = target_user_id;

IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
RAISE EXCEPTION 'Not authorized to change roles';
END IF;

IF new_role <> 'admin' THEN
SELECT count(*) INTO v_admin_count
FROM public.user_profiles
WHERE organization_id = v_caller_org AND role = 'admin';

IF v_admin_count <= 1 THEN
RAISE EXCEPTION 'An organization must keep at least one admin';
END IF;
END IF;

UPDATE public.user_profiles
SET role = new_role,
permissions = COALESCE(new_permissions, permissions)
WHERE user_id = target_user_id;
END;
$function$
;

-- public.check_approval_permission(p_item_type text, p_item_id uuid)
CREATE OR REPLACE FUNCTION public.check_approval_permission(p_item_type text, p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- public.create_user_profile()
CREATE OR REPLACE FUNCTION public.create_user_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_org_id uuid;
v_org_name text;
v_role text;
v_perms jsonb;
BEGIN
v_org_id := NEW.raw_app_meta_data->>'organization_id';

IF v_org_id IS NOT NULL THEN
-- Invited user: gets 'view' role with view-only permissions
v_role := 'view';
v_perms := '{"create_edit_leases":false,"delete_leases":false,"create_transactions":false,"run_month_end":false,"manage_modifications":false,"upload_documents":false,"manage_user_roles":false,"access_user_management":false,"view_reports_documents":true,"view_leases_transactions":true}'::jsonb;
ELSE
-- Self-signup: creates a new org, user is admin with all permissions
v_org_name := COALESCE(NEW.raw_user_meta_data->>'company_name', NEW.email);
INSERT INTO public.organizations (name) VALUES (v_org_name) RETURNING id INTO v_org_id;
v_role := 'admin';
v_perms := '{"create_edit_leases":true,"delete_leases":true,"create_transactions":true,"run_month_end":true,"manage_modifications":true,"upload_documents":true,"manage_user_roles":true,"access_user_management":true,"view_reports_documents":true,"view_leases_transactions":true}'::jsonb;

INSERT INTO public.subscriptions (organization_id, user_id, plan_key, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
VALUES (v_org_id, NEW.id, 'starter', 'monthly', 'trialing', now() + interval '5 days', now(), now() + interval '1 month')
ON CONFLICT (organization_id) DO NOTHING;
END IF;

INSERT INTO public.user_profiles (user_id, email, organization_id, role, permissions)
VALUES (NEW.id, NEW.email, v_org_id, v_role, v_perms)
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

RETURN NEW;
END;
$function$
;

-- public.get_all_users_with_plans()
CREATE OR REPLACE FUNCTION public.get_all_users_with_plans()
 RETURNS TABLE(user_id uuid, email text, full_name text, role text, organization_id uuid, org_name text, plan_key text, plan_status text, trial_ends_at timestamp with time zone, current_period_end timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$
BEGIN
IF NOT internal.is_platform_admin() THEN
RAISE EXCEPTION 'Platform administrator access required';
END IF;

RETURN QUERY
SELECT
up.user_id,
up.email,
up.full_name,
up.role,
up.organization_id,
o.name AS org_name,
s.plan_key,
s.status AS plan_status,
s.trial_ends_at,
s.current_period_end,
up.created_at
FROM public.user_profiles up
LEFT JOIN public.organizations o ON o.id = up.organization_id
LEFT JOIN LATERAL (
SELECT sub.plan_key, sub.status, sub.trial_ends_at, sub.current_period_end
FROM public.subscriptions sub
WHERE sub.organization_id = up.organization_id
ORDER BY sub.created_at DESC
LIMIT 1
) s ON true
ORDER BY o.name ASC, up.created_at ASC;
END;
$function$
;

-- public.get_data_health()
CREATE OR REPLACE FUNCTION public.get_data_health()
 RETURNS TABLE(organization_id uuid, check_key text, lease_id uuid, lease_name text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
BEGIN
IF auth.uid() IS NULL OR NOT internal.is_admin() THEN
RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
END IF;
RETURN QUERY SELECT * FROM internal.data_health(internal.current_org_id());
END;
$function$
;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid)
CREATE OR REPLACE FUNCTION public.get_filtered_transactions(p_page integer DEFAULT 1, p_page_size integer DEFAULT 12, p_search text DEFAULT ''::text, p_type text DEFAULT 'all'::text, p_period text DEFAULT 'all'::text, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_branch_id uuid DEFAULT NULL::uuid, p_branch_filter text DEFAULT 'all'::text, p_asset_type_id uuid DEFAULT NULL::uuid, p_asset_type_filter text DEFAULT 'all'::text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_total_count bigint; v_total_debits numeric; v_total_credits numeric;
v_rows jsonb; v_offset int;
v_org_id uuid;
BEGIN
v_org_id := internal.current_org_id();
v_offset := (p_page - 1) * p_page_size;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type, t.account_debited, t.account_credited,
t.debit_amount, t.credit_amount, t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
WHERE t.organization_id = v_org_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type, lt.account_debited, lt.account_credited,
lt.amount, lt.amount, lt.description, 'N/A', to_char(lt.transaction_date, 'YYYY-MM'), false, lt.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
fat.type_name, fat.type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
WHERE lt.transaction_type NOT IN ('modification', 'remeasurement') AND lt.modification_id IS NULL
AND lt.organization_id = v_org_id
),
filtered AS (
SELECT * FROM combined c WHERE
(p_search = '' OR c.description ILIKE '%'||p_search||'%' OR c.account_debited ILIKE '%'||p_search||'%' OR
c.account_credited ILIKE '%'||p_search||'%' OR c.reference_number ILIKE '%'||p_search||'%' OR c.lease_name ILIKE '%'||p_search||'%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND (CASE WHEN p_period = 'all' THEN true WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start) AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period END)
AND (CASE WHEN p_branch_filter = 'all' THEN true WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL ELSE c.branch_id = p_branch_id END)
AND (CASE WHEN p_asset_type_filter = 'all' THEN true WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL ELSE c.fixed_asset_type_id = p_asset_type_id END)
)
SELECT count(*), COALESCE(sum(debit_amount),0), COALESCE(sum(credit_amount),0)
INTO v_total_count, v_total_debits, v_total_credits FROM filtered;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type, t.account_debited, t.account_credited,
t.debit_amount, t.credit_amount, t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
WHERE t.organization_id = v_org_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type, lt.account_debited, lt.account_credited,
lt.amount, lt.amount, lt.description, 'N/A', to_char(lt.transaction_date, 'YYYY-MM'), false, lt.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
fat.type_name, fat.type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
WHERE lt.transaction_type NOT IN ('modification', 'remeasurement') AND lt.modification_id IS NULL
AND lt.organization_id = v_org_id
),
filtered AS (
SELECT * FROM combined c WHERE
(p_search = '' OR c.description ILIKE '%'||p_search||'%' OR c.account_debited ILIKE '%'||p_search||'%' OR
c.account_credited ILIKE '%'||p_search||'%' OR c.reference_number ILIKE '%'||p_search||'%' OR c.lease_name ILIKE '%'||p_search||'%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND (CASE WHEN p_period = 'all' THEN true WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start) AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period END)
AND (CASE WHEN p_branch_filter = 'all' THEN true WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL ELSE c.branch_id = p_branch_id END)
AND (CASE WHEN p_asset_type_filter = 'all' THEN true WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL ELSE c.fixed_asset_type_id = p_asset_type_id END)
)
SELECT jsonb_agg(row_to_json(f)::jsonb ORDER BY f.transaction_date DESC, f.created_at DESC)
INTO v_rows FROM (SELECT * FROM filtered ORDER BY transaction_date DESC, created_at DESC LIMIT p_page_size OFFSET v_offset) f;

RETURN jsonb_build_object('rows', COALESCE(v_rows,'[]'::jsonb), 'total_count', v_total_count,
'total_debits', v_total_debits, 'total_credits', v_total_credits,
'debit_summary', '{}'::jsonb, 'credit_summary', '{}'::jsonb);
END;
$function$
;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text)
CREATE OR REPLACE FUNCTION public.get_filtered_transactions(p_page integer DEFAULT 1, p_page_size integer DEFAULT 12, p_search text DEFAULT ''::text, p_type text DEFAULT 'all'::text, p_period text DEFAULT 'all'::text, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_branch_id uuid DEFAULT NULL::uuid, p_branch_filter text DEFAULT 'all'::text, p_asset_type_id uuid DEFAULT NULL::uuid, p_asset_type_filter text DEFAULT 'all'::text, p_company_id uuid DEFAULT NULL::uuid, p_lease_classification text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_total_count bigint;
v_total_debits numeric;
v_total_credits numeric;
v_rows jsonb;
v_offset int;
v_debit_summary jsonb;
v_credit_summary jsonb;
BEGIN
v_offset := (p_page - 1) * p_page_size;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
)
SELECT count(*), COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0)
INTO v_total_count, v_total_debits, v_total_credits
FROM filtered;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
)
SELECT jsonb_agg(row_to_json(f)::jsonb ORDER BY f.transaction_date DESC, f.created_at DESC)
INTO v_rows
FROM (
SELECT * FROM filtered
ORDER BY transaction_date DESC, created_at DESC
LIMIT p_page_size OFFSET v_offset
) f;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
)
SELECT
COALESCE(jsonb_object_agg(d.account_debited, d.total) FILTER (WHERE d.account_debited IS NOT NULL), '{}'::jsonb),
COALESCE(jsonb_object_agg(cr.account_credited, cr.total) FILTER (WHERE cr.account_credited IS NOT NULL), '{}'::jsonb)
INTO v_debit_summary, v_credit_summary
FROM
(SELECT account_debited, sum(debit_amount) AS total FROM filtered WHERE debit_amount > 0 GROUP BY account_debited) d
FULL OUTER JOIN
(SELECT account_credited, sum(credit_amount) AS total FROM filtered WHERE credit_amount > 0 GROUP BY account_credited) cr
ON false;

RETURN jsonb_build_object(
'rows', COALESCE(v_rows, '[]'::jsonb),
'total_count', v_total_count,
'total_debits', v_total_debits,
'total_credits', v_total_credits,
'debit_summary', COALESCE(v_debit_summary, '{}'::jsonb),
'credit_summary', COALESCE(v_credit_summary, '{}'::jsonb)
);
END;
$function$
;

-- public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[])
CREATE OR REPLACE FUNCTION public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(lease_id uuid, rou numeric, liability numeric, status text, current_portion numeric, opening_rou numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
SELECT
l.id,
round(b.rou, 2),
round(b.liability, 2),
b.status,
CASE WHEN b.status = 'active'
THEN round(least(b.liability, greatest(0, b.liability - COALESCE(n.liability, 0))), 2)
ELSE 0::numeric END,
COALESCE(round(f.rou_asset_balance + f.depreciation_expense, 2), 0::numeric)
FROM public.leases l
CROSS JOIN LATERAL internal.lease_balance_as_of(l.id, p_as_of) b
LEFT JOIN LATERAL internal.lease_balance_as_of(l.id, (p_as_of + interval '12 months')::date) n ON true
LEFT JOIN LATERAL (
SELECT a.rou_asset_balance, a.depreciation_expense
FROM public.amortization_schedules a
WHERE a.lease_id = l.id
ORDER BY a.period_number ASC
LIMIT 1
) f ON true
WHERE auth.uid() IS NOT NULL
AND p_as_of IS NOT NULL
AND l.organization_id = internal.current_org_id()
AND (internal.has_data_access() OR l.user_id = auth.uid())
AND (p_lease_ids IS NULL OR l.id = ANY (p_lease_ids));
$function$
;

-- public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean)
CREATE OR REPLACE FUNCTION public.get_lease_portfolio_totals(p_company_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_lease_type text DEFAULT NULL::text, p_lessor_type text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_branch_unassigned boolean DEFAULT false, p_as_of date DEFAULT CURRENT_DATE, p_status text DEFAULT NULL::text, p_missing_classification boolean DEFAULT false)
 RETURNS TABLE(bucket text, lease_count bigint, total_rou numeric, total_liability numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
SELECT EXISTS (
SELECT 1 FROM user_profiles
WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
AND organization_id = internal.current_org_id()
) AS has_access
),
filtered AS (
SELECT l.*
FROM leases l
CROSS JOIN user_has_data_access uda
WHERE (uda.has_access OR l.user_id = auth.uid())
AND l.organization_id = internal.current_org_id()
AND (p_company_id IS NULL OR l.company_id = p_company_id)
AND (
p_search IS NULL OR btrim(p_search) = ''
OR l.lease_name ILIKE '%' || btrim(p_search) || '%'
OR l.lessor_name ILIKE '%' || btrim(p_search) || '%'
)
AND (p_lease_type IS NULL OR l.lease_classification = p_lease_type)
AND (p_lessor_type IS NULL OR l.lessor_type = p_lessor_type)
AND (
CASE
WHEN p_branch_unassigned THEN l.branch_id IS NULL
WHEN p_branch_id IS NOT NULL THEN l.branch_id = p_branch_id
ELSE true
END
)
AND (
CASE p_status
WHEN 'active' THEN l.status = 'active'
AND l.lease_start_date <= COALESCE(p_as_of, CURRENT_DATE)
AND l.lease_end_date >= COALESCE(p_as_of, CURRENT_DATE)
WHEN 'not_started' THEN l.status = 'active'
AND l.lease_start_date > COALESCE(p_as_of, CURRENT_DATE)
WHEN 'ended' THEN l.status <> 'active'
OR l.lease_end_date < COALESCE(p_as_of, CURRENT_DATE)
ELSE true
END
)
AND (
NOT COALESCE(p_missing_classification, false)
OR (
l.lease_classification = 'finance'
AND COALESCE(l.accounting_treatment, 'recognized') <> 'short_term_exemption'
AND (COALESCE(l.asset_market_value, 0) <= 0 OR COALESCE(l.asset_economic_life_months, 0) <= 0)
)
)
)
SELECT
CASE
WHEN f.accounting_treatment = 'short_term_exemption' THEN 'short_term'
WHEN f.lease_classification = 'finance' THEN 'finance'
ELSE 'operating'
END AS bucket,
COUNT(*)::bigint AS lease_count,
COALESCE(SUM(b.rou), 0) AS total_rou,
COALESCE(SUM(b.liability), 0) AS total_liability
FROM filtered f
LEFT JOIN LATERAL internal.lease_balance_as_of(f.id, COALESCE(p_as_of, CURRENT_DATE)) b ON true
GROUP BY 1;
$function$
;

-- public.get_lease_posted_through(p_lease_id uuid)
CREATE OR REPLACE FUNCTION public.get_lease_posted_through(p_lease_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
SELECT max(ap.period_start)
FROM public.leases l
JOIN public.accounting_periods ap
ON ap.organization_id = l.organization_id
AND ap.status IN ('locked','closed')
AND ap.period_end >= l.lease_start_date
AND ap.period_start <= COALESCE(l.lease_end_date, ap.period_start)
WHERE l.id = p_lease_id;
$function$
;

-- public.get_lease_summary_stats(p_company_id uuid, p_as_of date)
CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
SELECT EXISTS (
SELECT 1 FROM user_profiles
WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
AND organization_id = internal.current_org_id()
) AS has_access
)
SELECT
COALESCE(SUM(b.rou), 0),
COALESCE(SUM(b.liability), 0),
COUNT(*) FILTER (
WHERE l.status = 'active'
AND l.lease_start_date <= COALESCE(p_as_of, CURRENT_DATE)
AND l.lease_end_date >= COALESCE(p_as_of, CURRENT_DATE)
)
FROM leases l
CROSS JOIN user_has_data_access uda
LEFT JOIN LATERAL internal.lease_balance_as_of(l.id, COALESCE(p_as_of, CURRENT_DATE)) b ON true
WHERE (uda.has_access OR l.user_id = auth.uid())
AND l.organization_id = internal.current_org_id()
AND (p_company_id IS NULL OR l.company_id = p_company_id);
$function$
;

-- public.get_ledger_reconciliation(p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.get_ledger_reconciliation(p_from date, p_to date)
 RETURNS TABLE(check_type text, lease_id uuid, lease_name text, period text, account text, posted numeric, expected numeric, difference numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
BEGIN
IF auth.uid() IS NULL OR NOT internal.has_data_access() THEN
RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
END IF;
RETURN QUERY SELECT * FROM internal.reconcile_ledgers(internal.current_org_id(), p_from, p_to);
END;
$function$
;

-- public.get_my_plan()
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
$function$
;

-- public.get_pending_approvals()
CREATE OR REPLACE FUNCTION public.get_pending_approvals()
 RETURNS TABLE(item_type text, item_id uuid, title text, summary text, amount numeric, prepared_by uuid, prepared_by_name text, prepared_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- public.get_platform_data_health()
CREATE OR REPLACE FUNCTION public.get_platform_data_health()
 RETURNS TABLE(organization_id uuid, organization_name text, check_key text, lease_id uuid, lease_name text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal'
AS $function$
BEGIN
IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
END IF;
RETURN QUERY
SELECT h.organization_id, o.name, h.check_key, h.lease_id, h.lease_name, h.detail
FROM public.organizations o
CROSS JOIN LATERAL internal.data_health(o.id) h
UNION ALL
SELECT s.organization_id, NULL::text, 'subscription_without_organization', NULL::uuid, NULL::text,
format('Subscription (%s, %s) is not linked to an existing organization', s.plan_key, s.status)
FROM public.subscriptions s
WHERE s.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations o2 WHERE o2.id = s.organization_id);
END;
$function$
;

-- public.get_user_emails_for_admin()
CREATE OR REPLACE FUNCTION public.get_user_emails_for_admin()
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ SELECT * FROM internal.get_user_emails_for_admin(); $function$
;

-- public.is_platform_admin()
CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$ SELECT internal.is_platform_admin() $function$
;

-- public.is_platform_admin_for_user(target_user_id uuid)
CREATE OR REPLACE FUNCTION public.is_platform_admin_for_user(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'internal', 'public'
AS $function$ SELECT internal.is_platform_admin_for_user(target_user_id) $function$
;

-- public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb)
CREATE OR REPLACE FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
v_lease public.leases%ROWTYPE;
v_org uuid;
v_posted_through date;
v_lock_end date;
v_kept int := 0;
v_deleted int := 0;
v_inserted int := 0;
v_bad_date date;
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'You must be signed in to refresh journal entries';
END IF;
IF NOT internal.is_manage_or_admin() OR NOT internal.has_permission('create_edit_leases') THEN
RAISE EXCEPTION 'You do not have permission to refresh journal entries';
END IF;
IF NOT (internal.org_has_active_subscription() OR internal.is_platform_admin()) THEN
RAISE EXCEPTION 'Your subscription is not active. Please subscribe to continue.';
END IF;

v_org := internal.current_org_id();
SELECT * INTO v_lease FROM public.leases WHERE id = p_lease_id;
IF NOT FOUND OR v_lease.organization_id IS DISTINCT FROM v_org THEN
RAISE EXCEPTION 'Lease not found in your organization';
END IF;

IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
RAISE EXCEPTION 'Journal entries must be a list';
END IF;

IF EXISTS (
SELECT 1 FROM jsonb_array_elements(p_entries) e
WHERE NULLIF(e->>'entry_date', '') IS NULL
OR NULLIF(btrim(e->>'entry_type'), '') IS NULL
OR NULLIF(btrim(e->>'account_name'), '') IS NULL
OR COALESCE((e->>'debit_amount')::numeric, 0) < 0
OR COALESCE((e->>'credit_amount')::numeric, 0) < 0
) THEN
RAISE EXCEPTION 'Each journal entry must have a date, type, account and non-negative amounts';
END IF;

IF EXISTS (
SELECT 1 FROM jsonb_array_elements(p_entries) e
WHERE NULLIF(e->>'amortization_id', '') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM public.amortization_schedules a
WHERE a.id = (e->>'amortization_id')::uuid AND a.lease_id = p_lease_id)
) THEN
RAISE EXCEPTION 'A journal entry refers to a schedule row of another lease';
END IF;

v_posted_through := public.get_lease_posted_through(p_lease_id);
IF v_posted_through IS NOT NULL THEN
v_lock_end := (date_trunc('month', v_posted_through) + interval '1 month - 1 day')::date;
END IF;

SELECT count(*) INTO v_kept FROM public.journal_entries j
WHERE j.lease_id = p_lease_id
AND ((v_lock_end IS NOT NULL AND j.entry_date <= v_lock_end)
OR internal.locked_period_status(v_org, j.entry_date, j.entry_date) IS NOT NULL);

-- Locked history may be filled once when it is empty; after that it is immutable.
IF v_kept > 0 THEN
SELECT min((e->>'entry_date')::date) INTO v_bad_date
FROM jsonb_array_elements(p_entries) e
WHERE (v_lock_end IS NOT NULL AND (e->>'entry_date')::date <= v_lock_end)
OR internal.locked_period_status(v_org, (e->>'entry_date')::date, (e->>'entry_date')::date) IS NOT NULL;
IF v_bad_date IS NOT NULL THEN
RAISE EXCEPTION 'Journal entries for % are in a posted period and cannot be replaced (posted through %).',
to_char(v_bad_date, 'FMMonth YYYY'),
COALESCE(to_char(v_posted_through, 'FMMonth YYYY'), to_char(v_bad_date, 'FMMonth YYYY'));
END IF;
END IF;

DELETE FROM public.journal_entries j
WHERE j.lease_id = p_lease_id
AND (v_lock_end IS NULL OR j.entry_date > v_lock_end)
AND internal.locked_period_status(v_org, j.entry_date, j.entry_date) IS NULL;
GET DIAGNOSTICS v_deleted = ROW_COUNT;

INSERT INTO public.journal_entries
(lease_id, organization_id, amortization_id, entry_date, entry_type, account_name,
debit_amount, credit_amount, description)
SELECT p_lease_id, v_org, NULLIF(e->>'amortization_id', '')::uuid, (e->>'entry_date')::date,
btrim(e->>'entry_type'), btrim(e->>'account_name'),
COALESCE((e->>'debit_amount')::numeric, 0), COALESCE((e->>'credit_amount')::numeric, 0),
COALESCE(e->>'description', '')
FROM jsonb_array_elements(p_entries) e
ON CONFLICT DO NOTHING;
GET DIAGNOSTICS v_inserted = ROW_COUNT;

RETURN jsonb_build_object(
'kept_locked', v_kept,
'deleted', v_deleted,
'inserted', v_inserted,
'posted_through', v_posted_through
);
END;
$function$
;

-- public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb)
CREATE OR REPLACE FUNCTION public.save_lease(p_lease jsonb, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_amortization jsonb DEFAULT '[]'::jsonb, p_recognition jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_accounting_keys constant text[] := ARRAY[
'company_id','lease_start_date','lease_end_date','lease_term_months','payment_amount','payment_frequency',
'payment_timing','payment_day_of_month','incremental_borrowing_rate','implicit_rate',
'implicit_rate_readily_determinable','risk_free_rate','discount_rate_method','discount_rate',
'accounting_treatment','lease_component_amount','nonlease_component_amount','component_policy',
'purchase_option_reasonably_certain','renewal_months_reasonably_certain','renewal_payment_amount',
'termination_option_month','termination_option_reasonably_certain','termination_penalty_amount',
'prepaid_lease_payments','lease_classification','initial_direct_costs','lease_incentives',
'transfer_ownership','purchase_option','purchase_option_price','asset_fair_value','asset_market_value',
'asset_economic_life_months','specialized_asset','residual_value_guarantee','rvg_probable_amount',
'rou_asset','lease_liability'];
v_empty constant jsonb[] := ARRAY['null'::jsonb, '0'::jsonb, 'false'::jsonb, '""'::jsonb];
v_lease_id uuid;
v_is_edit boolean;
v_caller_org_id uuid;
v_user_id uuid;
v_posted_through date;
v_old leases%ROWTYPE;
v_new leases%ROWTYPE;
v_old_json jsonb;
v_new_json jsonb;
v_changed text[] := ARRAY[]::text[];
v_key text;
v_o jsonb;
v_n jsonb;
v_idx int;
v_pay_row jsonb;
v_amort_row jsonb;
v_recog_row jsonb;
v_company_id uuid;
v_branch_id uuid;
v_fixed_asset_type_id uuid;
v_short_term_policy_election_id uuid;
v_risk_free_policy_election_id uuid;
v_component_policy_election_id uuid;
v_life_months int;
BEGIN
PERFORM set_config('app.saving_lease', 'on', true);

v_user_id := auth.uid();
IF v_user_id IS NULL THEN
RAISE EXCEPTION 'You must be authenticated to save a lease';
END IF;
IF NOT internal.is_manage_or_admin() THEN
RAISE EXCEPTION 'You do not have permission to create or edit leases';
END IF;
IF NOT internal.has_permission('create_edit_leases') THEN
RAISE EXCEPTION 'You do not have permission to create or edit leases';
END IF;
v_caller_org_id := internal.current_org_id();
IF NOT (internal.org_has_active_subscription() OR internal.is_platform_admin()) THEN
RAISE EXCEPTION 'Your subscription is not active. Please subscribe to continue.';
END IF;

v_lease_id := (p_lease->>'id')::uuid;
v_is_edit := v_lease_id IS NOT NULL;

IF v_is_edit THEN
SELECT * INTO v_old FROM leases WHERE id = v_lease_id;
IF NOT FOUND OR v_old.organization_id IS DISTINCT FROM v_caller_org_id THEN
RAISE EXCEPTION 'Lease not found in your organization';
END IF;
SELECT max(ap.period_start) INTO v_posted_through
FROM accounting_periods ap
WHERE ap.organization_id = v_caller_org_id
AND ap.status IN ('locked', 'closed')
AND ap.period_end >= v_old.lease_start_date
AND ap.period_start <= COALESCE(v_old.lease_end_date, ap.period_start);
IF v_posted_through IS NOT NULL THEN
p_lease := (to_jsonb(v_old) - 'id') || p_lease;
PERFORM set_config('app.saving_lease', 'posted', true);
END IF;
END IF;

v_company_id := NULLIF(p_lease->>'company_id', '')::uuid;
v_branch_id := NULLIF(p_lease->>'branch_id', '')::uuid;
v_fixed_asset_type_id := NULLIF(p_lease->>'fixed_asset_type_id', '')::uuid;
v_short_term_policy_election_id := NULLIF(p_lease->>'short_term_policy_election_id', '')::uuid;
v_risk_free_policy_election_id := NULLIF(p_lease->>'risk_free_policy_election_id', '')::uuid;
v_component_policy_election_id := NULLIF(p_lease->>'component_policy_election_id', '')::uuid;
v_life_months := COALESCE(
NULLIF(p_lease->>'asset_economic_life_months', '')::numeric,
round(NULLIF(p_lease->>'asset_economic_life_years', '')::numeric * 12),
0)::int;

IF v_company_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM companies WHERE id = v_company_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid company: does not belong to your organization';
END IF;
IF v_branch_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM branches WHERE id = v_branch_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid branch: does not belong to your organization';
END IF;
IF v_fixed_asset_type_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM fixed_asset_types WHERE id = v_fixed_asset_type_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid asset type: does not belong to your organization';
END IF;
IF v_short_term_policy_election_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM accounting_policy_elections WHERE id = v_short_term_policy_election_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
END IF;
IF v_risk_free_policy_election_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM accounting_policy_elections WHERE id = v_risk_free_policy_election_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
END IF;
IF v_component_policy_election_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM accounting_policy_elections WHERE id = v_component_policy_election_id AND organization_id = v_caller_org_id) THEN
RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
END IF;

IF v_is_edit THEN
UPDATE leases SET
company_id                    = v_company_id,
branch_id                     = v_branch_id,
fixed_asset_type_id           = v_fixed_asset_type_id,
lease_name                    = p_lease->>'lease_name',
lease_description             = COALESCE(p_lease->>'lease_description', ''),
lessor_name                   = p_lease->>'lessor_name',
lessor_type                   = p_lease->>'lessor_type',
lease_start_date              = (p_lease->>'lease_start_date')::date,
lease_end_date                = (p_lease->>'lease_end_date')::date,
lease_term_months             = (p_lease->>'lease_term_months')::int,
payment_amount                = (p_lease->>'payment_amount')::numeric,
payment_frequency             = p_lease->>'payment_frequency',
incremental_borrowing_rate    = (p_lease->>'incremental_borrowing_rate')::numeric,
implicit_rate                 = NULLIF(p_lease->>'implicit_rate', '')::numeric,
implicit_rate_readily_determinable = COALESCE((p_lease->>'implicit_rate_readily_determinable')::boolean, false),
risk_free_rate                = NULLIF(p_lease->>'risk_free_rate', '')::numeric,
risk_free_rate_source         = NULLIF(p_lease->>'risk_free_rate_source', ''),
risk_free_rate_date           = NULLIF(p_lease->>'risk_free_rate_date', '')::date,
discount_rate_method          = p_lease->>'discount_rate_method',
discount_rate                 = NULLIF(p_lease->>'discount_rate', '')::numeric,
rate_source                   = NULLIF(p_lease->>'rate_source', ''),
rate_date                     = NULLIF(p_lease->>'rate_date', '')::date,
risk_free_policy_election_id  = v_risk_free_policy_election_id,
accounting_treatment          = p_lease->>'accounting_treatment',
short_term_policy_election_id = v_short_term_policy_election_id,
lease_component_amount        = COALESCE(NULLIF(p_lease->>'lease_component_amount', '')::numeric, 0),
nonlease_component_amount     = COALESCE(NULLIF(p_lease->>'nonlease_component_amount', '')::numeric, 0),
component_policy              = p_lease->>'component_policy',
component_policy_election_id  = v_component_policy_election_id,
related_party                 = COALESCE((p_lease->>'related_party')::boolean, false),
related_party_name            = NULLIF(p_lease->>'related_party_name', ''),
purchase_option_reasonably_certain = COALESCE((p_lease->>'purchase_option_reasonably_certain')::boolean, false),
renewal_months_reasonably_certain  = COALESCE(NULLIF(p_lease->>'renewal_months_reasonably_certain', '')::int, 0),
renewal_payment_amount        = NULLIF(p_lease->>'renewal_payment_amount', '')::numeric,
termination_option_month      = NULLIF(p_lease->>'termination_option_month', '')::int,
termination_option_reasonably_certain = COALESCE((p_lease->>'termination_option_reasonably_certain')::boolean, false),
termination_penalty_amount    = COALESCE(NULLIF(p_lease->>'termination_penalty_amount', '')::numeric, 0),
prepaid_lease_payments        = COALESCE(NULLIF(p_lease->>'prepaid_lease_payments', '')::numeric, 0),
lease_classification          = p_lease->>'lease_classification',
initial_direct_costs          = COALESCE(NULLIF(p_lease->>'initial_direct_costs', '')::numeric, 0),
lease_incentives              = COALESCE(NULLIF(p_lease->>'lease_incentives', '')::numeric, 0),
payment_timing                = p_lease->>'payment_timing',
payment_day_of_month          = NULLIF(p_lease->>'payment_day_of_month', '')::int,
transfer_ownership            = COALESCE((p_lease->>'transfer_ownership')::boolean, false),
purchase_option               = COALESCE((p_lease->>'purchase_option')::boolean, false),
purchase_option_price         = COALESCE(NULLIF(p_lease->>'purchase_option_price', '')::numeric, 0),
asset_fair_value              = COALESCE(NULLIF(p_lease->>'asset_fair_value', '')::numeric, 0),
asset_market_value            = COALESCE(NULLIF(p_lease->>'asset_market_value', '')::numeric, 0),
asset_economic_life_months    = v_life_months,
specialized_asset             = COALESCE((p_lease->>'specialized_asset')::boolean, false),
residual_value_guarantee      = COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
rvg_probable_amount           = COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
auto_classified               = COALESCE((p_lease->>'auto_classified')::boolean, false),
rou_asset                     = COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
lease_liability               = COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
status                        = COALESCE(p_lease->>'status', 'active'),
updated_at                    = now()
WHERE id = v_lease_id
RETURNING * INTO v_new;

IF v_posted_through IS NOT NULL THEN
v_old_json := to_jsonb(v_old);
v_new_json := to_jsonb(v_new);
FOREACH v_key IN ARRAY v_accounting_keys LOOP
v_o := COALESCE(v_old_json->v_key, 'null'::jsonb);
v_n := COALESCE(v_new_json->v_key, 'null'::jsonb);
IF v_o IS DISTINCT FROM v_n AND NOT (v_o = ANY (v_empty) AND v_n = ANY (v_empty)) THEN
v_changed := v_changed || v_key;
END IF;
END LOOP;
IF cardinality(v_changed) > 0 THEN
RAISE EXCEPTION 'This lease has posted periods. Use Contract Modification to change it.'
USING DETAIL = 'Posted through ' || to_char(v_posted_through, 'YYYY-MM') || '; changed: ' || array_to_string(v_changed, ', ');
END IF;
END IF;
ELSE
INSERT INTO leases (
organization_id, user_id, company_id, branch_id, fixed_asset_type_id,
lease_name, lease_description, lessor_name, lessor_type,
lease_start_date, lease_end_date, lease_term_months,
payment_amount, payment_frequency, incremental_borrowing_rate,
implicit_rate, implicit_rate_readily_determinable,
risk_free_rate, risk_free_rate_source, risk_free_rate_date,
discount_rate_method, discount_rate, rate_source, rate_date,
risk_free_policy_election_id, accounting_treatment, short_term_policy_election_id,
lease_component_amount, nonlease_component_amount, component_policy, component_policy_election_id,
related_party, related_party_name,
purchase_option_reasonably_certain, renewal_months_reasonably_certain, renewal_payment_amount,
termination_option_month, termination_option_reasonably_certain, termination_penalty_amount,
prepaid_lease_payments, lease_classification, initial_direct_costs, lease_incentives,
payment_timing, payment_day_of_month,
transfer_ownership, purchase_option, purchase_option_price,
asset_fair_value, asset_market_value, asset_economic_life_months,
specialized_asset, residual_value_guarantee, rvg_probable_amount,
auto_classified, rou_asset, lease_liability, status,
is_complete
) VALUES (
v_caller_org_id, v_user_id, v_company_id, v_branch_id, v_fixed_asset_type_id,
p_lease->>'lease_name',
COALESCE(p_lease->>'lease_description', ''),
p_lease->>'lessor_name',
p_lease->>'lessor_type',
(p_lease->>'lease_start_date')::date,
(p_lease->>'lease_end_date')::date,
(p_lease->>'lease_term_months')::int,
(p_lease->>'payment_amount')::numeric,
p_lease->>'payment_frequency',
(p_lease->>'incremental_borrowing_rate')::numeric,
NULLIF(p_lease->>'implicit_rate', '')::numeric,
COALESCE((p_lease->>'implicit_rate_readily_determinable')::boolean, false),
NULLIF(p_lease->>'risk_free_rate', '')::numeric,
NULLIF(p_lease->>'risk_free_rate_source', ''),
NULLIF(p_lease->>'risk_free_rate_date', '')::date,
p_lease->>'discount_rate_method',
NULLIF(p_lease->>'discount_rate', '')::numeric,
NULLIF(p_lease->>'rate_source', ''),
NULLIF(p_lease->>'rate_date', '')::date,
v_risk_free_policy_election_id,
p_lease->>'accounting_treatment',
v_short_term_policy_election_id,
COALESCE(NULLIF(p_lease->>'lease_component_amount', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'nonlease_component_amount', '')::numeric, 0),
p_lease->>'component_policy',
v_component_policy_election_id,
COALESCE((p_lease->>'related_party')::boolean, false),
NULLIF(p_lease->>'related_party_name', ''),
COALESCE((p_lease->>'purchase_option_reasonably_certain')::boolean, false),
COALESCE(NULLIF(p_lease->>'renewal_months_reasonably_certain', '')::int, 0),
NULLIF(p_lease->>'renewal_payment_amount', '')::numeric,
NULLIF(p_lease->>'termination_option_month', '')::int,
COALESCE((p_lease->>'termination_option_reasonably_certain')::boolean, false),
COALESCE(NULLIF(p_lease->>'termination_penalty_amount', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'prepaid_lease_payments', '')::numeric, 0),
p_lease->>'lease_classification',
COALESCE(NULLIF(p_lease->>'initial_direct_costs', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'lease_incentives', '')::numeric, 0),
p_lease->>'payment_timing',
NULLIF(p_lease->>'payment_day_of_month', '')::int,
COALESCE((p_lease->>'transfer_ownership')::boolean, false),
COALESCE((p_lease->>'purchase_option')::boolean, false),
COALESCE(NULLIF(p_lease->>'purchase_option_price', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'asset_fair_value', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'asset_market_value', '')::numeric, 0),
v_life_months,
COALESCE((p_lease->>'specialized_asset')::boolean, false),
COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
COALESCE((p_lease->>'auto_classified')::boolean, false),
COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
COALESCE(p_lease->>'status', 'active'),
false
)
RETURNING id INTO v_lease_id;
END IF;

IF v_posted_through IS NULL THEN
DELETE FROM lease_payment_schedules WHERE lease_id = v_lease_id;
v_idx := 0;
WHILE v_idx < jsonb_array_length(p_payment_schedule) LOOP
v_pay_row := p_payment_schedule->v_idx;
INSERT INTO lease_payment_schedules (lease_id, from_month, to_month, payment_amount, organization_id)
VALUES (v_lease_id, (v_pay_row->>'from_month')::int, (v_pay_row->>'to_month')::int,
(v_pay_row->>'payment_amount')::numeric, v_caller_org_id);
v_idx := v_idx + 1;
END LOOP;

DELETE FROM amortization_schedules WHERE lease_id = v_lease_id;
v_idx := 0;
WHILE v_idx < jsonb_array_length(p_amortization) LOOP
v_amort_row := p_amortization->v_idx;
INSERT INTO amortization_schedules (
lease_id, period_number, period_date,
beginning_liability, payment_amount, interest_expense,
principal_reduction, ending_liability, rou_asset_balance,
depreciation_expense, short_term_lease_cost, organization_id
) VALUES (
v_lease_id,
(v_amort_row->>'period_number')::int,
(v_amort_row->>'period_date')::date,
COALESCE((v_amort_row->>'beginning_liability')::numeric, 0),
COALESCE((v_amort_row->>'payment_amount')::numeric, 0),
COALESCE((v_amort_row->>'interest_expense')::numeric, 0),
COALESCE((v_amort_row->>'principal_reduction')::numeric, 0),
COALESCE((v_amort_row->>'ending_liability')::numeric, 0),
COALESCE((v_amort_row->>'rou_asset_balance')::numeric, 0),
COALESCE((v_amort_row->>'depreciation_expense')::numeric, 0),
COALESCE((v_amort_row->>'short_term_lease_cost')::numeric, 0),
v_caller_org_id
);
v_idx := v_idx + 1;
END LOOP;

IF jsonb_array_length(p_recognition) > 0 THEN
IF v_is_edit THEN
DELETE FROM lease_transactions
WHERE lease_id = v_lease_id AND transaction_type = 'initial_recognition';
END IF;
v_idx := 0;
WHILE v_idx < jsonb_array_length(p_recognition) LOOP
v_recog_row := p_recognition->v_idx;
INSERT INTO lease_transactions (
lease_id, transaction_date, transaction_type,
description, account_debited, account_credited,
amount, user_id, organization_id
) VALUES (
v_lease_id,
(v_recog_row->>'transaction_date')::date,
'initial_recognition',
v_recog_row->>'description',
v_recog_row->>'account_debited',
v_recog_row->>'account_credited',
(v_recog_row->>'amount')::numeric,
v_user_id,
v_caller_org_id
);
v_idx := v_idx + 1;
END LOOP;
END IF;
END IF;

UPDATE leases SET is_complete = true, updated_at = now() WHERE id = v_lease_id;

RETURN v_lease_id;
END;
$function$
;

-- public.set_classification_override(p_lease_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION public.set_classification_override(p_lease_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'You must be authenticated';
END IF;
IF NOT internal.is_manage_or_admin() OR NOT internal.has_permission('create_edit_leases') THEN
RAISE EXCEPTION 'You do not have permission to create or edit leases';
END IF;

UPDATE public.leases
SET classification_override_reason = NULLIF(btrim(p_reason), '')
WHERE id = p_lease_id
AND organization_id = internal.current_org_id();

IF NOT FOUND THEN
RAISE EXCEPTION 'Lease not found';
END IF;
END;
$function$
;

-- public.sync_user_profile_email()
CREATE OR REPLACE FUNCTION public.sync_user_profile_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NEW.email IS DISTINCT FROM OLD.email THEN
UPDATE public.user_profiles
SET email = NEW.email
WHERE user_id = NEW.id;
END IF;
RETURN NEW;
END;
$function$
;

-- public.update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$function$
;


-- ============ Tables (32) ============

-- internal.platform_admins
CREATE TABLE IF NOT EXISTS internal.platform_admins (
  user_id uuid NOT NULL
);

-- public.accounting_periods
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  period text DEFAULT ''::text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text DEFAULT 'open'::text,
  total_debits numeric(15,2) DEFAULT 0,
  total_credits numeric(15,2) DEFAULT 0,
  closed_by text DEFAULT ''::text,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.accounting_policy_elections
CREATE TABLE IF NOT EXISTS public.accounting_policy_elections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  company_id uuid NOT NULL,
  fixed_asset_type_id uuid NOT NULL,
  policy_type text NOT NULL,
  election_value boolean NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text DEFAULT 'draft'::text NOT NULL,
  policy_version integer NOT NULL,
  notes text,
  change_reason text,
  supporting_document_id uuid,
  prepared_by uuid,
  prepared_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  self_approved boolean DEFAULT false NOT NULL,
  rejection_comment text
);

-- public.amortization_schedules
CREATE TABLE IF NOT EXISTS public.amortization_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  period_number integer NOT NULL,
  period_date date NOT NULL,
  beginning_liability numeric(15,2) NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  interest_expense numeric(15,2) NOT NULL,
  principal_reduction numeric(15,2) NOT NULL,
  ending_liability numeric(15,2) NOT NULL,
  rou_asset_balance numeric(15,2) NOT NULL,
  depreciation_expense numeric(15,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  short_term_lease_cost numeric DEFAULT 0 NOT NULL
);

-- public.approval_settings
CREATE TABLE IF NOT EXISTS public.approval_settings (
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  require_different_approver boolean DEFAULT false NOT NULL,
  approver_role text DEFAULT 'admin'::text NOT NULL,
  item_types text[] DEFAULT ARRAY['policy_election'::text, 'contract_modification'::text, 'contract_cancellation'::text, 'impairment'::text, 'month_end'::text] NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- public.audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  actor_user_id uuid,
  table_name text NOT NULL,
  record_id text NOT NULL,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- public.branches
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  branch_name text NOT NULL,
  branch_code text DEFAULT ''::text,
  address text DEFAULT ''::text,
  city text DEFAULT ''::text,
  state text DEFAULT ''::text,
  country text DEFAULT ''::text,
  postal_code text DEFAULT ''::text,
  manager_name text DEFAULT ''::text,
  contact_email text DEFAULT ''::text,
  contact_phone text DEFAULT ''::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.companies
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  company_name text NOT NULL,
  company_code text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  tax_id text,
  industry text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  entity_type text
);

-- public.contract_cancellations
CREATE TABLE IF NOT EXISTS public.contract_cancellations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  cancellation_date date DEFAULT CURRENT_DATE NOT NULL,
  cancellation_reason text DEFAULT ''::text,
  early_termination boolean DEFAULT false,
  termination_penalty numeric(15,2) DEFAULT 0,
  remaining_rou_asset numeric(15,2) DEFAULT 0,
  remaining_lease_liability numeric(15,2) DEFAULT 0,
  gain_loss_amount numeric(15,2) DEFAULT 0,
  final_payment_amount numeric(15,2) DEFAULT 0,
  settlement_details text DEFAULT ''::text,
  approved_by text DEFAULT ''::text,
  status text DEFAULT 'draft'::text,
  derecognition_posted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  prepared_by uuid DEFAULT auth.uid(),
  approved_at timestamp with time zone,
  self_approved boolean DEFAULT false NOT NULL,
  rejection_comment text
);

-- public.contract_modifications
CREATE TABLE IF NOT EXISTS public.contract_modifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  modification_date date DEFAULT CURRENT_DATE NOT NULL,
  modification_type text DEFAULT 'payment_change'::text NOT NULL,
  reason text DEFAULT ''::text,
  old_monthly_payment numeric(15,2) DEFAULT 0,
  new_monthly_payment numeric(15,2) DEFAULT 0,
  old_lease_term integer DEFAULT 0,
  new_lease_term integer DEFAULT 0,
  old_discount_rate numeric(7,4) DEFAULT 0,
  new_discount_rate numeric(7,4) DEFAULT 0,
  old_rou_asset numeric(15,2) DEFAULT 0,
  new_rou_asset numeric(15,2) DEFAULT 0,
  old_lease_liability numeric(15,2) DEFAULT 0,
  new_lease_liability numeric(15,2) DEFAULT 0,
  accounting_treatment text DEFAULT ''::text NOT NULL,
  remeasurement_required boolean DEFAULT true,
  notes text DEFAULT ''::text,
  approved_by text DEFAULT ''::text,
  status text DEFAULT 'draft'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  accounting_posted boolean DEFAULT false NOT NULL,
  separate_contract boolean DEFAULT false NOT NULL,
  fair_value_at_modification numeric,
  remaining_economic_life_months integer,
  reassessed_classification text,
  prepared_by uuid DEFAULT auth.uid(),
  approved_at timestamp with time zone,
  self_approved boolean DEFAULT false NOT NULL,
  rejection_comment text
);

-- public.documents
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lease_id uuid,
  file_name text DEFAULT ''::text NOT NULL,
  file_path text DEFAULT ''::text NOT NULL,
  file_type text DEFAULT ''::text,
  file_size bigint DEFAULT 0,
  category text DEFAULT 'General'::text,
  description text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.error_logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id bigint NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id(),
  user_id uuid,
  message text NOT NULL,
  stack text,
  route text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

-- public.fixed_asset_types
CREATE TABLE IF NOT EXISTS public.fixed_asset_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  type_name text NOT NULL,
  type_code text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.journal_entries
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  amortization_id uuid,
  entry_date date NOT NULL,
  entry_type text NOT NULL,
  account_name text NOT NULL,
  debit_amount numeric(15,2) DEFAULT 0,
  credit_amount numeric(15,2) DEFAULT 0,
  description text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.lease_impairments
CREATE TABLE IF NOT EXISTS public.lease_impairments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  lease_id uuid NOT NULL,
  impairment_date date NOT NULL,
  impairment_amount numeric NOT NULL,
  reason text,
  posted boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'pending_approval'::text NOT NULL,
  prepared_by uuid DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamp with time zone,
  self_approved boolean DEFAULT false NOT NULL,
  rejection_comment text
);

-- public.lease_modifications
CREATE TABLE IF NOT EXISTS public.lease_modifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  modification_date date NOT NULL,
  modification_type text NOT NULL,
  description text NOT NULL,
  old_value text DEFAULT ''::text,
  new_value text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.lease_payment_schedules
CREATE TABLE IF NOT EXISTS public.lease_payment_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  from_month integer NOT NULL,
  to_month integer NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.lease_payments
CREATE TABLE IF NOT EXISTS public.lease_payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  payment_date date NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  payment_type text DEFAULT 'base_rent'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.lease_transactions
CREATE TABLE IF NOT EXISTS public.lease_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lease_id uuid NOT NULL,
  modification_id uuid,
  transaction_date date NOT NULL,
  transaction_type text NOT NULL,
  description text NOT NULL,
  account_debited text NOT NULL,
  account_credited text NOT NULL,
  amount numeric(15,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.leases
CREATE TABLE IF NOT EXISTS public.leases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lease_name text NOT NULL,
  lease_description text DEFAULT ''::text,
  lessor_name text NOT NULL,
  lease_start_date date NOT NULL,
  lease_end_date date NOT NULL,
  lease_term_months integer NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  payment_frequency text DEFAULT 'monthly'::text NOT NULL,
  incremental_borrowing_rate numeric(7,4) NOT NULL,
  lease_classification text DEFAULT 'operating'::text NOT NULL,
  initial_direct_costs numeric(15,2) DEFAULT 0,
  lease_incentives numeric(15,2) DEFAULT 0,
  rou_asset numeric(15,2),
  lease_liability numeric(15,2),
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  payment_timing text DEFAULT 'beginning'::text,
  transfer_ownership boolean DEFAULT false,
  purchase_option boolean DEFAULT false,
  purchase_option_price numeric DEFAULT 0,
  asset_fair_value numeric DEFAULT 0,
  specialized_asset boolean DEFAULT false,
  residual_value_guarantee numeric DEFAULT 0,
  auto_classified boolean DEFAULT false,
  lessor_type text DEFAULT 'corporate'::text NOT NULL,
  branch_id uuid,
  asset_market_value numeric(15,2) DEFAULT 0 NOT NULL,
  fixed_asset_type_id uuid,
  company_id uuid,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  implicit_rate numeric,
  implicit_rate_readily_determinable boolean DEFAULT false NOT NULL,
  risk_free_rate numeric,
  risk_free_rate_source text,
  risk_free_rate_date date,
  discount_rate_method text,
  discount_rate numeric,
  rate_source text,
  rate_date date,
  risk_free_policy_election_id uuid,
  accounting_treatment text DEFAULT 'recognized'::text NOT NULL,
  short_term_policy_election_id uuid,
  lease_component_amount numeric DEFAULT 0 NOT NULL,
  nonlease_component_amount numeric DEFAULT 0 NOT NULL,
  component_policy text DEFAULT 'not_applicable'::text NOT NULL,
  component_policy_election_id uuid,
  related_party boolean DEFAULT false NOT NULL,
  related_party_name text,
  payment_day_of_month integer,
  rvg_probable_amount numeric DEFAULT 0 NOT NULL,
  purchase_option_reasonably_certain boolean DEFAULT false NOT NULL,
  renewal_months_reasonably_certain integer DEFAULT 0 NOT NULL,
  renewal_payment_amount numeric,
  termination_option_month integer,
  termination_option_reasonably_certain boolean DEFAULT false NOT NULL,
  termination_penalty_amount numeric DEFAULT 0 NOT NULL,
  prepaid_lease_payments numeric DEFAULT 0 NOT NULL,
  is_complete boolean DEFAULT true NOT NULL,
  classification_override_reason text,
  asset_economic_life_months integer DEFAULT 0
);

-- public.lessors
CREATE TABLE IF NOT EXISTS public.lessors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  lessor_name text NOT NULL,
  lessor_type text DEFAULT 'corporate'::text NOT NULL,
  contact_email text,
  contact_phone text,
  address text,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- public.month_end_documents
CREATE TABLE IF NOT EXISTS public.month_end_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  period text NOT NULL,
  period_label text NOT NULL,
  lease_count integer DEFAULT 0 NOT NULL,
  transaction_count integer DEFAULT 0 NOT NULL,
  total_interest numeric DEFAULT 0 NOT NULL,
  total_depreciation numeric DEFAULT 0 NOT NULL,
  total_principal numeric DEFAULT 0 NOT NULL,
  status text DEFAULT 'posted'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL,
  prepared_by uuid DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamp with time zone,
  self_approved boolean DEFAULT false NOT NULL,
  rejection_comment text,
  entries jsonb
);

-- public.organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  require_second_approver boolean DEFAULT false NOT NULL
);

-- public.stripe_customers
CREATE TABLE IF NOT EXISTS public.stripe_customers (
  id bigint NOT NULL,
  user_id uuid NOT NULL,
  customer_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);

-- public.stripe_orders
CREATE TABLE IF NOT EXISTS public.stripe_orders (
  id bigint NOT NULL,
  checkout_session_id text NOT NULL,
  payment_intent_id text NOT NULL,
  customer_id text NOT NULL,
  amount_subtotal bigint NOT NULL,
  amount_total bigint NOT NULL,
  currency text NOT NULL,
  payment_status text NOT NULL,
  status stripe_order_status DEFAULT 'pending'::stripe_order_status NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);

-- public.stripe_processed_events
CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- public.stripe_subscriptions
CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
  id bigint NOT NULL,
  customer_id text NOT NULL,
  subscription_id text,
  price_id text,
  current_period_start bigint,
  current_period_end bigint,
  cancel_at_period_end boolean DEFAULT false,
  payment_method_brand text,
  payment_method_last4 text,
  status stripe_subscription_status NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);

-- public.subscription_plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plan_key text NOT NULL,
  plan_name text NOT NULL,
  max_leases integer NOT NULL,
  price_monthly numeric(10,2) NOT NULL,
  price_annually numeric(10,2) NOT NULL,
  features jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  stripe_price_id_monthly text,
  stripe_price_id_annually text
);

-- public.subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  plan_key text NOT NULL,
  billing_cycle text DEFAULT 'monthly'::text NOT NULL,
  status text DEFAULT 'trialing'::text NOT NULL,
  trial_ends_at timestamp with time zone DEFAULT (now() + '5 days'::interval),
  current_period_start timestamp with time zone DEFAULT now(),
  current_period_end timestamp with time zone DEFAULT (now() + '1 mon'::interval),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  organization_id uuid NOT NULL
);

-- public.transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  transaction_date date DEFAULT CURRENT_DATE NOT NULL,
  transaction_type text DEFAULT 'payment'::text NOT NULL,
  account_debited text DEFAULT ''::text NOT NULL,
  account_credited text DEFAULT ''::text NOT NULL,
  debit_amount numeric(15,2) DEFAULT 0 NOT NULL,
  credit_amount numeric(15,2) DEFAULT 0 NOT NULL,
  description text DEFAULT ''::text,
  reference_number text DEFAULT ''::text,
  period text DEFAULT ''::text,
  is_reversed boolean DEFAULT false,
  reversal_of uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  month_end_document_id uuid,
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.user_activity_logs
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  activity_type text DEFAULT ''::text NOT NULL,
  activity_description text DEFAULT ''::text NOT NULL,
  ip_address text DEFAULT ''::text,
  user_agent text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid DEFAULT internal.current_org_id() NOT NULL
);

-- public.user_profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  full_name text DEFAULT ''::text,
  phone_number text DEFAULT ''::text,
  company_name text DEFAULT ''::text,
  job_title text DEFAULT ''::text,
  theme text DEFAULT 'light'::text,
  date_format text DEFAULT 'MM/DD/YYYY'::text,
  currency text DEFAULT 'USD'::text,
  timezone text DEFAULT 'America/New_York'::text,
  language text DEFAULT 'en'::text,
  email_notifications boolean DEFAULT true,
  lease_expiry_alerts boolean DEFAULT true,
  payment_reminders boolean DEFAULT true,
  monthly_reports boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  role text DEFAULT 'view'::text,
  permissions jsonb DEFAULT '{"delete_leases": true, "run_month_end": true, "upload_documents": true, "manage_user_roles": false, "create_edit_leases": true, "create_transactions": true, "manage_modifications": true, "access_user_management": false, "view_reports_documents": true, "view_leases_transactions": true}'::jsonb,
  email text DEFAULT ''::text,
  organization_id uuid NOT NULL
);


-- ============ Constraints (156) ============

-- internal.platform_admins.platform_admins_pkey
ALTER TABLE internal.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (user_id);

-- internal.platform_admins.platform_admins_user_id_fkey
ALTER TABLE internal.platform_admins ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.accounting_periods.accounting_periods_organization_id_fkey
ALTER TABLE public.accounting_periods ADD CONSTRAINT accounting_periods_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.accounting_periods.accounting_periods_pkey
ALTER TABLE public.accounting_periods ADD CONSTRAINT accounting_periods_pkey PRIMARY KEY (id);

-- public.accounting_periods.accounting_periods_status_check
ALTER TABLE public.accounting_periods ADD CONSTRAINT accounting_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'locked'::text])));

-- public.accounting_periods.accounting_periods_user_id_fkey
ALTER TABLE public.accounting_periods ADD CONSTRAINT accounting_periods_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.accounting_policy_elections.accounting_policy_elections_company_id_fkey
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- public.accounting_policy_elections.accounting_policy_elections_fixed_asset_type_id_fkey
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_fixed_asset_type_id_fkey FOREIGN KEY (fixed_asset_type_id) REFERENCES fixed_asset_types(id) ON DELETE CASCADE;

-- public.accounting_policy_elections.accounting_policy_elections_organization_id_fkey
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- public.accounting_policy_elections.accounting_policy_elections_pkey
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_pkey PRIMARY KEY (id);

-- public.accounting_policy_elections.accounting_policy_elections_policy_type_check
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_policy_type_check CHECK ((policy_type = ANY (ARRAY['SHORT_TERM_LEASE'::text, 'COMBINE_LEASE_NONLEASE'::text, 'RISK_FREE_RATE'::text])));

-- public.accounting_policy_elections.accounting_policy_elections_status_check
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'inactive'::text])));

-- public.accounting_policy_elections.accounting_policy_elections_supporting_document_id_fkey
ALTER TABLE public.accounting_policy_elections ADD CONSTRAINT accounting_policy_elections_supporting_document_id_fkey FOREIGN KEY (supporting_document_id) REFERENCES documents(id) ON DELETE SET NULL;

-- public.amortization_schedules.amortization_schedules_lease_id_fkey
ALTER TABLE public.amortization_schedules ADD CONSTRAINT amortization_schedules_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.amortization_schedules.amortization_schedules_organization_id_fkey
ALTER TABLE public.amortization_schedules ADD CONSTRAINT amortization_schedules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.amortization_schedules.amortization_schedules_pkey
ALTER TABLE public.amortization_schedules ADD CONSTRAINT amortization_schedules_pkey PRIMARY KEY (id);

-- public.approval_settings.approval_settings_approver_role_check
ALTER TABLE public.approval_settings ADD CONSTRAINT approval_settings_approver_role_check CHECK ((approver_role = ANY (ARRAY['admin'::text, 'manage'::text])));

-- public.approval_settings.approval_settings_item_types_check
ALTER TABLE public.approval_settings ADD CONSTRAINT approval_settings_item_types_check CHECK ((item_types <@ ARRAY['policy_election'::text, 'contract_modification'::text, 'contract_cancellation'::text, 'impairment'::text, 'month_end'::text]));

-- public.approval_settings.approval_settings_organization_id_fkey
ALTER TABLE public.approval_settings ADD CONSTRAINT approval_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- public.approval_settings.approval_settings_pkey
ALTER TABLE public.approval_settings ADD CONSTRAINT approval_settings_pkey PRIMARY KEY (organization_id);

-- public.approval_settings.approval_settings_updated_by_fkey
ALTER TABLE public.approval_settings ADD CONSTRAINT approval_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- public.audit_log.audit_log_action_check
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'BACKFILL'::text, 'REOPEN'::text, 'Self-approved'::text, 'Auto-approved (single-user plan)'::text, 'Approved'::text, 'Rejected'::text, 'Auto-approved (approval workflow off)'::text])));

-- public.audit_log.audit_log_organization_id_fkey
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- public.audit_log.audit_log_pkey
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

-- public.branches.branches_organization_id_fkey
ALTER TABLE public.branches ADD CONSTRAINT branches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.branches.branches_pkey
ALTER TABLE public.branches ADD CONSTRAINT branches_pkey PRIMARY KEY (id);

-- public.branches.branches_user_id_fkey
ALTER TABLE public.branches ADD CONSTRAINT branches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.companies.companies_entity_type_check
ALTER TABLE public.companies ADD CONSTRAINT companies_entity_type_check CHECK (((entity_type IS NULL) OR (entity_type = ANY (ARRAY['public_business_entity'::text, 'non_public_business_entity'::text, 'not_for_profit_other'::text]))));

-- public.companies.companies_organization_id_fkey
ALTER TABLE public.companies ADD CONSTRAINT companies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.companies.companies_pkey
ALTER TABLE public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

-- public.companies.companies_user_id_company_name_key
ALTER TABLE public.companies ADD CONSTRAINT companies_user_id_company_name_key UNIQUE (user_id, company_name);

-- public.companies.companies_user_id_fkey
ALTER TABLE public.companies ADD CONSTRAINT companies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.contract_cancellations.contract_cancellations_lease_id_fkey
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.contract_cancellations.contract_cancellations_organization_id_fkey
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.contract_cancellations.contract_cancellations_pkey
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_pkey PRIMARY KEY (id);

-- public.contract_cancellations.contract_cancellations_status_check
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));

-- public.contract_cancellations.contract_cancellations_user_id_fkey
ALTER TABLE public.contract_cancellations ADD CONSTRAINT contract_cancellations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.contract_modifications.contract_modifications_accounting_treatment_check
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_accounting_treatment_check CHECK ((accounting_treatment = ANY (ARRAY['remeasurement'::text, 'separate_lease'::text, 'partial_termination'::text, 'other'::text])));

-- public.contract_modifications.contract_modifications_lease_id_fkey
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.contract_modifications.contract_modifications_modification_type_check
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_modification_type_check CHECK ((modification_type = ANY (ARRAY['payment_change'::text, 'term_extension'::text, 'term_reduction'::text, 'rate_change'::text, 'scope_change'::text, 'other'::text])));

-- public.contract_modifications.contract_modifications_organization_id_fkey
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.contract_modifications.contract_modifications_pkey
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_pkey PRIMARY KEY (id);

-- public.contract_modifications.contract_modifications_status_check
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));

-- public.contract_modifications.contract_modifications_user_id_fkey
ALTER TABLE public.contract_modifications ADD CONSTRAINT contract_modifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.documents.documents_file_size_non_negative
ALTER TABLE public.documents ADD CONSTRAINT documents_file_size_non_negative CHECK ((file_size >= 0));

-- public.documents.documents_lease_id_fkey
ALTER TABLE public.documents ADD CONSTRAINT documents_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE SET NULL;

-- public.documents.documents_organization_id_fkey
ALTER TABLE public.documents ADD CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.documents.documents_pkey
ALTER TABLE public.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

-- public.documents.documents_user_id_fkey
ALTER TABLE public.documents ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.error_logs.error_logs_message_check
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_message_check CHECK ((char_length(message) <= 2000));

-- public.error_logs.error_logs_organization_id_fkey
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.error_logs.error_logs_pkey
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);

-- public.error_logs.error_logs_stack_check
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_stack_check CHECK (((stack IS NULL) OR (char_length(stack) <= 8000)));

-- public.fixed_asset_types.fixed_asset_types_organization_id_fkey
ALTER TABLE public.fixed_asset_types ADD CONSTRAINT fixed_asset_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.fixed_asset_types.fixed_asset_types_pkey
ALTER TABLE public.fixed_asset_types ADD CONSTRAINT fixed_asset_types_pkey PRIMARY KEY (id);

-- public.fixed_asset_types.fixed_asset_types_user_id_fkey
ALTER TABLE public.fixed_asset_types ADD CONSTRAINT fixed_asset_types_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.journal_entries.journal_entries_amortization_id_fkey
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_amortization_id_fkey FOREIGN KEY (amortization_id) REFERENCES amortization_schedules(id) ON DELETE CASCADE;

-- public.journal_entries.journal_entries_lease_id_fkey
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.journal_entries.journal_entries_organization_id_fkey
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.journal_entries.journal_entries_pkey
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);

-- public.lease_impairments.lease_impairments_impairment_amount_check
ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_impairment_amount_check CHECK ((impairment_amount > (0)::numeric));

-- public.lease_impairments.lease_impairments_lease_id_fkey
ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id);

-- public.lease_impairments.lease_impairments_organization_id_fkey
ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

-- public.lease_impairments.lease_impairments_pkey
ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_pkey PRIMARY KEY (id);

-- public.lease_impairments.lease_impairments_status_check
ALTER TABLE public.lease_impairments ADD CONSTRAINT lease_impairments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text])));

-- public.lease_modifications.lease_modifications_lease_id_fkey
ALTER TABLE public.lease_modifications ADD CONSTRAINT lease_modifications_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.lease_modifications.lease_modifications_organization_id_fkey
ALTER TABLE public.lease_modifications ADD CONSTRAINT lease_modifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.lease_modifications.lease_modifications_pkey
ALTER TABLE public.lease_modifications ADD CONSTRAINT lease_modifications_pkey PRIMARY KEY (id);

-- public.lease_payment_schedules.lease_payment_schedules_check
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_check CHECK ((to_month >= from_month));

-- public.lease_payment_schedules.lease_payment_schedules_from_month_check
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_from_month_check CHECK ((from_month >= 1));

-- public.lease_payment_schedules.lease_payment_schedules_lease_id_fkey
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.lease_payment_schedules.lease_payment_schedules_organization_id_fkey
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.lease_payment_schedules.lease_payment_schedules_payment_amount_check
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_payment_amount_check CHECK ((payment_amount >= (0)::numeric));

-- public.lease_payment_schedules.lease_payment_schedules_pkey
ALTER TABLE public.lease_payment_schedules ADD CONSTRAINT lease_payment_schedules_pkey PRIMARY KEY (id);

-- public.lease_payments.lease_payments_lease_id_fkey
ALTER TABLE public.lease_payments ADD CONSTRAINT lease_payments_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.lease_payments.lease_payments_organization_id_fkey
ALTER TABLE public.lease_payments ADD CONSTRAINT lease_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.lease_payments.lease_payments_pkey
ALTER TABLE public.lease_payments ADD CONSTRAINT lease_payments_pkey PRIMARY KEY (id);

-- public.lease_transactions.lease_transactions_amount_check
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_amount_check CHECK ((amount >= (0)::numeric));

-- public.lease_transactions.lease_transactions_lease_id_fkey
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.lease_transactions.lease_transactions_modification_id_fkey
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_modification_id_fkey FOREIGN KEY (modification_id) REFERENCES contract_modifications(id) ON DELETE SET NULL;

-- public.lease_transactions.lease_transactions_organization_id_fkey
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.lease_transactions.lease_transactions_pkey
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_pkey PRIMARY KEY (id);

-- public.lease_transactions.lease_transactions_transaction_type_check
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['initial_recognition'::text, 'modification'::text, 'remeasurement'::text, 'termination'::text, 'impairment'::text])));

-- public.lease_transactions.lease_transactions_user_id_fkey
ALTER TABLE public.lease_transactions ADD CONSTRAINT lease_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- public.leases.leases_accounting_treatment_check
ALTER TABLE public.leases ADD CONSTRAINT leases_accounting_treatment_check CHECK ((accounting_treatment = ANY (ARRAY['recognized'::text, 'short_term_exemption'::text])));

-- public.leases.leases_asset_economic_life_months_nonneg
ALTER TABLE public.leases ADD CONSTRAINT leases_asset_economic_life_months_nonneg CHECK ((asset_economic_life_months >= 0));

-- public.leases.leases_branch_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- public.leases.leases_company_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- public.leases.leases_component_policy_check
ALTER TABLE public.leases ADD CONSTRAINT leases_component_policy_check CHECK ((component_policy = ANY (ARRAY['combined'::text, 'separate'::text, 'not_applicable'::text])));

-- public.leases.leases_component_policy_election_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_component_policy_election_id_fkey FOREIGN KEY (component_policy_election_id) REFERENCES accounting_policy_elections(id) ON DELETE SET NULL;

-- public.leases.leases_date_order
ALTER TABLE public.leases ADD CONSTRAINT leases_date_order CHECK ((lease_end_date > lease_start_date));

-- public.leases.leases_discount_rate_method_check
ALTER TABLE public.leases ADD CONSTRAINT leases_discount_rate_method_check CHECK (((discount_rate_method IS NULL) OR (discount_rate_method = ANY (ARRAY['implicit'::text, 'risk_free'::text, 'ibr'::text]))));

-- public.leases.leases_discount_rate_range
ALTER TABLE public.leases ADD CONSTRAINT leases_discount_rate_range CHECK (((discount_rate IS NULL) OR ((discount_rate >= (0)::numeric) AND (discount_rate < (100)::numeric))));

-- public.leases.leases_fixed_asset_type_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_fixed_asset_type_id_fkey FOREIGN KEY (fixed_asset_type_id) REFERENCES fixed_asset_types(id) ON DELETE SET NULL;

-- public.leases.leases_ibr_range
ALTER TABLE public.leases ADD CONSTRAINT leases_ibr_range CHECK (((incremental_borrowing_rate >= (0)::numeric) AND (incremental_borrowing_rate < (100)::numeric)));

-- public.leases.leases_implicit_rate_range
ALTER TABLE public.leases ADD CONSTRAINT leases_implicit_rate_range CHECK (((implicit_rate IS NULL) OR ((implicit_rate >= (0)::numeric) AND (implicit_rate < (100)::numeric))));

-- public.leases.leases_initial_direct_costs_nonneg
ALTER TABLE public.leases ADD CONSTRAINT leases_initial_direct_costs_nonneg CHECK (((initial_direct_costs IS NULL) OR (initial_direct_costs >= (0)::numeric)));

-- public.leases.leases_lease_classification_check
ALTER TABLE public.leases ADD CONSTRAINT leases_lease_classification_check CHECK ((lease_classification = ANY (ARRAY['operating'::text, 'finance'::text])));

-- public.leases.leases_lease_incentives_nonneg
ALTER TABLE public.leases ADD CONSTRAINT leases_lease_incentives_nonneg CHECK (((lease_incentives IS NULL) OR (lease_incentives >= (0)::numeric)));

-- public.leases.leases_lease_term_months_positive
ALTER TABLE public.leases ADD CONSTRAINT leases_lease_term_months_positive CHECK ((lease_term_months > 0));

-- public.leases.leases_lessor_type_check
ALTER TABLE public.leases ADD CONSTRAINT leases_lessor_type_check CHECK ((lessor_type = ANY (ARRAY['corporate'::text, 'individual'::text, 'government'::text, 'financial_institution'::text, 'other'::text])));

-- public.leases.leases_nonlease_component_amount_check
ALTER TABLE public.leases ADD CONSTRAINT leases_nonlease_component_amount_check CHECK ((nonlease_component_amount >= (0)::numeric));

-- public.leases.leases_organization_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.leases.leases_payment_amount_nonneg
ALTER TABLE public.leases ADD CONSTRAINT leases_payment_amount_nonneg CHECK ((payment_amount >= (0)::numeric));

-- public.leases.leases_payment_day_of_month_check
ALTER TABLE public.leases ADD CONSTRAINT leases_payment_day_of_month_check CHECK (((payment_day_of_month IS NULL) OR ((payment_day_of_month >= 1) AND (payment_day_of_month <= 31))));

-- public.leases.leases_payment_frequency_check
ALTER TABLE public.leases ADD CONSTRAINT leases_payment_frequency_check CHECK ((payment_frequency = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'semi_annually'::text, 'annually'::text, 'weekly'::text])));

-- public.leases.leases_payment_timing_check
ALTER TABLE public.leases ADD CONSTRAINT leases_payment_timing_check CHECK ((payment_timing = ANY (ARRAY['beginning'::text, 'end'::text])));

-- public.leases.leases_pkey
ALTER TABLE public.leases ADD CONSTRAINT leases_pkey PRIMARY KEY (id);

-- public.leases.leases_prepaid_lease_payments_nonneg
ALTER TABLE public.leases ADD CONSTRAINT leases_prepaid_lease_payments_nonneg CHECK ((prepaid_lease_payments >= (0)::numeric));

-- public.leases.leases_risk_free_policy_election_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_risk_free_policy_election_id_fkey FOREIGN KEY (risk_free_policy_election_id) REFERENCES accounting_policy_elections(id) ON DELETE SET NULL;

-- public.leases.leases_rvg_probable_amount_check
ALTER TABLE public.leases ADD CONSTRAINT leases_rvg_probable_amount_check CHECK ((rvg_probable_amount >= (0)::numeric));

-- public.leases.leases_short_term_policy_election_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_short_term_policy_election_id_fkey FOREIGN KEY (short_term_policy_election_id) REFERENCES accounting_policy_elections(id) ON DELETE SET NULL;

-- public.leases.leases_status_check
ALTER TABLE public.leases ADD CONSTRAINT leases_status_check CHECK ((status = ANY (ARRAY['active'::text, 'terminated'::text, 'expired'::text, 'cancelled'::text, 'pending'::text])));

-- public.leases.leases_user_id_fkey
ALTER TABLE public.leases ADD CONSTRAINT leases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- public.lessors.lessors_organization_id_fkey
ALTER TABLE public.lessors ADD CONSTRAINT lessors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- public.lessors.lessors_pkey
ALTER TABLE public.lessors ADD CONSTRAINT lessors_pkey PRIMARY KEY (id);

-- public.lessors.lessors_user_id_fkey
ALTER TABLE public.lessors ADD CONSTRAINT lessors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.month_end_documents.month_end_documents_organization_id_fkey
ALTER TABLE public.month_end_documents ADD CONSTRAINT month_end_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.month_end_documents.month_end_documents_pkey
ALTER TABLE public.month_end_documents ADD CONSTRAINT month_end_documents_pkey PRIMARY KEY (id);

-- public.month_end_documents.month_end_documents_status_check
ALTER TABLE public.month_end_documents ADD CONSTRAINT month_end_documents_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'posted'::text, 'finalized'::text, 'closed'::text])));

-- public.month_end_documents.month_end_documents_user_id_fkey
ALTER TABLE public.month_end_documents ADD CONSTRAINT month_end_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.month_end_documents.month_end_documents_user_period_unique
ALTER TABLE public.month_end_documents ADD CONSTRAINT month_end_documents_user_period_unique UNIQUE (user_id, period);

-- public.organizations.organizations_pkey
ALTER TABLE public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

-- public.stripe_customers.stripe_customers_customer_id_key
ALTER TABLE public.stripe_customers ADD CONSTRAINT stripe_customers_customer_id_key UNIQUE (customer_id);

-- public.stripe_customers.stripe_customers_pkey
ALTER TABLE public.stripe_customers ADD CONSTRAINT stripe_customers_pkey PRIMARY KEY (id);

-- public.stripe_customers.stripe_customers_user_id_fkey
ALTER TABLE public.stripe_customers ADD CONSTRAINT stripe_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- public.stripe_customers.stripe_customers_user_id_key
ALTER TABLE public.stripe_customers ADD CONSTRAINT stripe_customers_user_id_key UNIQUE (user_id);

-- public.stripe_orders.stripe_orders_pkey
ALTER TABLE public.stripe_orders ADD CONSTRAINT stripe_orders_pkey PRIMARY KEY (id);

-- public.stripe_processed_events.stripe_processed_events_pkey
ALTER TABLE public.stripe_processed_events ADD CONSTRAINT stripe_processed_events_pkey PRIMARY KEY (event_id);

-- public.stripe_subscriptions.stripe_subscriptions_customer_id_key
ALTER TABLE public.stripe_subscriptions ADD CONSTRAINT stripe_subscriptions_customer_id_key UNIQUE (customer_id);

-- public.stripe_subscriptions.stripe_subscriptions_pkey
ALTER TABLE public.stripe_subscriptions ADD CONSTRAINT stripe_subscriptions_pkey PRIMARY KEY (id);

-- public.subscription_plans.subscription_plans_pkey
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);

-- public.subscription_plans.subscription_plans_plan_key_key
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_plan_key_key UNIQUE (plan_key);

-- public.subscriptions.subscriptions_billing_cycle_check
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'annually'::text])));

-- public.subscriptions.subscriptions_organization_id_fkey
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.subscriptions.subscriptions_pkey
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

-- public.subscriptions.subscriptions_plan_key_fkey
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_key_fkey FOREIGN KEY (plan_key) REFERENCES subscription_plans(plan_key);

-- public.subscriptions.subscriptions_status_check
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'cancelled'::text])));

-- public.subscriptions.subscriptions_user_id_fkey
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.transactions.transactions_lease_id_fkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE;

-- public.transactions.transactions_month_end_document_id_fkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_month_end_document_id_fkey FOREIGN KEY (month_end_document_id) REFERENCES month_end_documents(id) ON DELETE CASCADE;

-- public.transactions.transactions_organization_id_fkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.transactions.transactions_pkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

-- public.transactions.transactions_reversal_of_fkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES transactions(id) ON DELETE SET NULL;

-- public.transactions.transactions_transaction_type_check
ALTER TABLE public.transactions ADD CONSTRAINT transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['payment'::text, 'interest'::text, 'amortization'::text, 'initial_recognition'::text, 'lease_modification'::text, 'lease_cancellation'::text, 'impairment'::text, 'derecognition'::text, 'reversal'::text, 'operating_lease_expense'::text, 'short_term_lease_expense'::text, 'nonlease_component_expense'::text])));

-- public.transactions.transactions_user_id_fkey
ALTER TABLE public.transactions ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.user_activity_logs.user_activity_logs_organization_id_fkey
ALTER TABLE public.user_activity_logs ADD CONSTRAINT user_activity_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.user_activity_logs.user_activity_logs_pkey
ALTER TABLE public.user_activity_logs ADD CONSTRAINT user_activity_logs_pkey PRIMARY KEY (id);

-- public.user_activity_logs.user_activity_logs_user_id_fkey
ALTER TABLE public.user_activity_logs ADD CONSTRAINT user_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.user_profiles.user_profiles_date_format_check
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_date_format_check CHECK ((date_format = ANY (ARRAY['MM/DD/YYYY'::text, 'DD/MM/YYYY'::text, 'YYYY-MM-DD'::text])));

-- public.user_profiles.user_profiles_organization_id_fkey
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- public.user_profiles.user_profiles_pkey
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);

-- public.user_profiles.user_profiles_role_check
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manage'::text, 'view'::text])));

-- public.user_profiles.user_profiles_theme_check
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_theme_check CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'auto'::text])));

-- public.user_profiles.user_profiles_user_id_fkey
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.user_profiles.user_profiles_user_id_key
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);


-- ============ Indexes (84) ============

-- public.accounting_periods_org_period_key
CREATE UNIQUE INDEX accounting_periods_org_period_key ON public.accounting_periods USING btree (organization_id, period);

-- public.accounting_periods_org_range_idx
CREATE INDEX accounting_periods_org_range_idx ON public.accounting_periods USING btree (organization_id, period_start, period_end) WHERE (status = ANY (ARRAY['locked'::text, 'closed'::text]));

-- public.fixed_asset_types_org_name_unique
CREATE UNIQUE INDEX fixed_asset_types_org_name_unique ON public.fixed_asset_types USING btree (organization_id, lower(btrim(type_name)));

-- public.idx_accounting_periods_organization_id
CREATE INDEX idx_accounting_periods_organization_id ON public.accounting_periods USING btree (organization_id);

-- public.idx_accounting_policy_elections_company_id
CREATE INDEX idx_accounting_policy_elections_company_id ON public.accounting_policy_elections USING btree (company_id);

-- public.idx_accounting_policy_elections_fixed_asset_type_id
CREATE INDEX idx_accounting_policy_elections_fixed_asset_type_id ON public.accounting_policy_elections USING btree (fixed_asset_type_id);

-- public.idx_accounting_policy_elections_supporting_document_id
CREATE INDEX idx_accounting_policy_elections_supporting_document_id ON public.accounting_policy_elections USING btree (supporting_document_id);

-- public.idx_amortization_lease_date_period
CREATE INDEX idx_amortization_lease_date_period ON public.amortization_schedules USING btree (lease_id, period_date, period_number);

-- public.idx_amortization_schedules_lease_id
CREATE INDEX idx_amortization_schedules_lease_id ON public.amortization_schedules USING btree (lease_id);

-- public.idx_amortization_schedules_organization_id
CREATE INDEX idx_amortization_schedules_organization_id ON public.amortization_schedules USING btree (organization_id);

-- public.idx_audit_log_org_created
CREATE INDEX idx_audit_log_org_created ON public.audit_log USING btree (organization_id, created_at DESC);

-- public.idx_audit_log_organization_id
CREATE INDEX idx_audit_log_organization_id ON public.audit_log USING btree (organization_id);

-- public.idx_audit_log_table_record
CREATE INDEX idx_audit_log_table_record ON public.audit_log USING btree (table_name, record_id);

-- public.idx_branches_organization_id
CREATE INDEX idx_branches_organization_id ON public.branches USING btree (organization_id);

-- public.idx_branches_user_active_name
CREATE INDEX idx_branches_user_active_name ON public.branches USING btree (user_id, is_active, branch_name);

-- public.idx_cancellations_lease_id
CREATE INDEX idx_cancellations_lease_id ON public.contract_cancellations USING btree (lease_id);

-- public.idx_cancellations_user_id
CREATE INDEX idx_cancellations_user_id ON public.contract_cancellations USING btree (user_id);

-- public.idx_companies_organization_id
CREATE INDEX idx_companies_organization_id ON public.companies USING btree (organization_id);

-- public.idx_companies_user_id
CREATE INDEX idx_companies_user_id ON public.companies USING btree (user_id);

-- public.idx_contract_cancellations_organization_id
CREATE INDEX idx_contract_cancellations_organization_id ON public.contract_cancellations USING btree (organization_id);

-- public.idx_contract_modifications_organization_id
CREATE INDEX idx_contract_modifications_organization_id ON public.contract_modifications USING btree (organization_id);

-- public.idx_documents_lease_id
CREATE INDEX idx_documents_lease_id ON public.documents USING btree (lease_id);

-- public.idx_documents_organization_id
CREATE INDEX idx_documents_organization_id ON public.documents USING btree (organization_id);

-- public.idx_documents_user_created_at
CREATE INDEX idx_documents_user_created_at ON public.documents USING btree (user_id, created_at DESC);

-- public.idx_error_logs_org_created
CREATE INDEX idx_error_logs_org_created ON public.error_logs USING btree (organization_id, created_at DESC);

-- public.idx_error_logs_organization_id
CREATE INDEX idx_error_logs_organization_id ON public.error_logs USING btree (organization_id);

-- public.idx_error_logs_user_created
CREATE INDEX idx_error_logs_user_created ON public.error_logs USING btree (user_id, created_at DESC);

-- public.idx_fixed_asset_types_organization_id
CREATE INDEX idx_fixed_asset_types_organization_id ON public.fixed_asset_types USING btree (organization_id);

-- public.idx_fixed_asset_types_user_id
CREATE INDEX idx_fixed_asset_types_user_id ON public.fixed_asset_types USING btree (user_id);

-- public.idx_journal_entries_amortization_id
CREATE INDEX idx_journal_entries_amortization_id ON public.journal_entries USING btree (amortization_id) WHERE (amortization_id IS NOT NULL);

-- public.idx_journal_entries_lease_id
CREATE INDEX idx_journal_entries_lease_id ON public.journal_entries USING btree (lease_id);

-- public.idx_journal_entries_organization_id
CREATE INDEX idx_journal_entries_organization_id ON public.journal_entries USING btree (organization_id);

-- public.idx_lease_impairments_lease_id
CREATE INDEX idx_lease_impairments_lease_id ON public.lease_impairments USING btree (lease_id);

-- public.idx_lease_impairments_organization_id
CREATE INDEX idx_lease_impairments_organization_id ON public.lease_impairments USING btree (organization_id);

-- public.idx_lease_modifications_lease_id
CREATE INDEX idx_lease_modifications_lease_id ON public.lease_modifications USING btree (lease_id);

-- public.idx_lease_modifications_organization_id
CREATE INDEX idx_lease_modifications_organization_id ON public.lease_modifications USING btree (organization_id);

-- public.idx_lease_payment_schedules_lease_id
CREATE INDEX idx_lease_payment_schedules_lease_id ON public.lease_payment_schedules USING btree (lease_id);

-- public.idx_lease_payment_schedules_organization_id
CREATE INDEX idx_lease_payment_schedules_organization_id ON public.lease_payment_schedules USING btree (organization_id);

-- public.idx_lease_payments_lease_id
CREATE INDEX idx_lease_payments_lease_id ON public.lease_payments USING btree (lease_id);

-- public.idx_lease_payments_organization_id
CREATE INDEX idx_lease_payments_organization_id ON public.lease_payments USING btree (organization_id);

-- public.idx_lease_transactions_date
CREATE INDEX idx_lease_transactions_date ON public.lease_transactions USING btree (transaction_date);

-- public.idx_lease_transactions_lease_date
CREATE INDEX idx_lease_transactions_lease_date ON public.lease_transactions USING btree (lease_id, transaction_date);

-- public.idx_lease_transactions_lease_id
CREATE INDEX idx_lease_transactions_lease_id ON public.lease_transactions USING btree (lease_id);

-- public.idx_lease_transactions_modification_id
CREATE INDEX idx_lease_transactions_modification_id ON public.lease_transactions USING btree (modification_id) WHERE (modification_id IS NOT NULL);

-- public.idx_lease_transactions_organization_id
CREATE INDEX idx_lease_transactions_organization_id ON public.lease_transactions USING btree (organization_id);

-- public.idx_lease_transactions_user_id
CREATE INDEX idx_lease_transactions_user_id ON public.lease_transactions USING btree (user_id) WHERE (user_id IS NOT NULL);

-- public.idx_leases_branch_id
CREATE INDEX idx_leases_branch_id ON public.leases USING btree (branch_id);

-- public.idx_leases_company_id
CREATE INDEX idx_leases_company_id ON public.leases USING btree (company_id);

-- public.idx_leases_component_policy_election_id
CREATE INDEX idx_leases_component_policy_election_id ON public.leases USING btree (component_policy_election_id);

-- public.idx_leases_fixed_asset_type_id
CREATE INDEX idx_leases_fixed_asset_type_id ON public.leases USING btree (fixed_asset_type_id);

-- public.idx_leases_organization_id
CREATE INDEX idx_leases_organization_id ON public.leases USING btree (organization_id);

-- public.idx_leases_risk_free_policy_election
CREATE INDEX idx_leases_risk_free_policy_election ON public.leases USING btree (risk_free_policy_election_id) WHERE (risk_free_policy_election_id IS NOT NULL);

-- public.idx_leases_short_term_policy_election_id
CREATE INDEX idx_leases_short_term_policy_election_id ON public.leases USING btree (short_term_policy_election_id);

-- public.idx_leases_user_lease_name
CREATE INDEX idx_leases_user_lease_name ON public.leases USING btree (user_id, lease_name text_pattern_ops);

-- public.idx_leases_user_status
CREATE INDEX idx_leases_user_status ON public.leases USING btree (user_id, status);

-- public.idx_lessors_is_active
CREATE INDEX idx_lessors_is_active ON public.lessors USING btree (is_active);

-- public.idx_lessors_organization_id
CREATE INDEX idx_lessors_organization_id ON public.lessors USING btree (organization_id);

-- public.idx_modifications_lease_id
CREATE INDEX idx_modifications_lease_id ON public.contract_modifications USING btree (lease_id);

-- public.idx_modifications_lease_status_date
CREATE INDEX idx_modifications_lease_status_date ON public.contract_modifications USING btree (lease_id, status, modification_date DESC);

-- public.idx_modifications_status
CREATE INDEX idx_modifications_status ON public.contract_modifications USING btree (status);

-- public.idx_modifications_user_id
CREATE INDEX idx_modifications_user_id ON public.contract_modifications USING btree (user_id);

-- public.idx_month_end_documents_organization_id
CREATE INDEX idx_month_end_documents_organization_id ON public.month_end_documents USING btree (organization_id);

-- public.idx_policy_elections_lookup
CREATE INDEX idx_policy_elections_lookup ON public.accounting_policy_elections USING btree (company_id, fixed_asset_type_id, policy_type, effective_from);

-- public.idx_policy_elections_org
CREATE INDEX idx_policy_elections_org ON public.accounting_policy_elections USING btree (organization_id);

-- public.idx_subscriptions_org_unique
CREATE UNIQUE INDEX idx_subscriptions_org_unique ON public.subscriptions USING btree (organization_id);

-- public.idx_subscriptions_organization_id
CREATE INDEX idx_subscriptions_organization_id ON public.subscriptions USING btree (organization_id);

-- public.idx_subscriptions_plan_key_fkey
CREATE INDEX idx_subscriptions_plan_key_fkey ON public.subscriptions USING btree (plan_key);

-- public.idx_subscriptions_user_id
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);

-- public.idx_transactions_date
CREATE INDEX idx_transactions_date ON public.transactions USING btree (transaction_date DESC);

-- public.idx_transactions_lease_date
CREATE INDEX idx_transactions_lease_date ON public.transactions USING btree (lease_id, transaction_date);

-- public.idx_transactions_lease_id
CREATE INDEX idx_transactions_lease_id ON public.transactions USING btree (lease_id);

-- public.idx_transactions_month_end_doc_fkey
CREATE INDEX idx_transactions_month_end_doc_fkey ON public.transactions USING btree (month_end_document_id);

-- public.idx_transactions_organization_id
CREATE INDEX idx_transactions_organization_id ON public.transactions USING btree (organization_id);

-- public.idx_transactions_reversal_of_fkey
CREATE INDEX idx_transactions_reversal_of_fkey ON public.transactions USING btree (reversal_of);

-- public.idx_transactions_user_id
CREATE INDEX idx_transactions_user_id ON public.transactions USING btree (user_id);

-- public.idx_transactions_user_type_date
CREATE INDEX idx_transactions_user_type_date ON public.transactions USING btree (user_id, transaction_type, transaction_date DESC);

-- public.idx_user_activity_logs_organization_id
CREATE INDEX idx_user_activity_logs_organization_id ON public.user_activity_logs USING btree (organization_id);

-- public.idx_user_activity_logs_user_id
CREATE INDEX idx_user_activity_logs_user_id ON public.user_activity_logs USING btree (user_id);

-- public.idx_user_profiles_organization_id
CREATE INDEX idx_user_profiles_organization_id ON public.user_profiles USING btree (organization_id);

-- public.idx_user_profiles_role
CREATE INDEX idx_user_profiles_role ON public.user_profiles USING btree (role);

-- public.idx_user_profiles_user_id
CREATE INDEX idx_user_profiles_user_id ON public.user_profiles USING btree (user_id);

-- public.journal_entries_natural_key
CREATE UNIQUE INDEX journal_entries_natural_key ON public.journal_entries USING btree (lease_id, entry_date, entry_type, account_name, amortization_id, description) NULLS NOT DISTINCT;

-- public.leases_org_company_complete_idx
CREATE INDEX leases_org_company_complete_idx ON public.leases USING btree (organization_id, company_id, is_complete);

-- public.leases_org_company_name_unique_idx
CREATE UNIQUE INDEX leases_org_company_name_unique_idx ON public.leases USING btree (organization_id, company_id, lower(TRIM(BOTH FROM lease_name))) WHERE (status = 'active'::text);


-- ============ Functions that return a table row type (2) ============

-- internal.reopen_month_end(p_doc_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text)
 RETURNS month_end_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_doc public.month_end_documents;
v_org_id uuid;
v_latest text;
BEGIN
IF NOT internal.is_admin() THEN
RAISE EXCEPTION 'Only admins can reopen month-end documents';
END IF;
IF p_reason IS NULL OR trim(p_reason) = '' THEN
RAISE EXCEPTION 'A reason is required to reopen a month-end document';
END IF;
v_org_id := internal.current_org_id();
SELECT * INTO v_doc FROM public.month_end_documents WHERE id = p_doc_id AND organization_id = v_org_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Month-end document not found';
END IF;
IF v_doc.status NOT IN ('finalized', 'closed') THEN
RAISE EXCEPTION 'Only finalized or closed documents can be reopened';
END IF;
SELECT max(left(d.period, 7)) INTO v_latest FROM public.month_end_documents d
WHERE d.organization_id = v_org_id AND d.status IN ('posted', 'finalized', 'closed');
IF left(v_doc.period, 7) < v_latest THEN
RAISE EXCEPTION 'Remove later months first (latest posted: %)', to_char(to_date(v_latest || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
END IF;
PERFORM set_config('app.skip_period_check', '1', true);
UPDATE public.month_end_documents SET status = 'posted' WHERE id = p_doc_id RETURNING * INTO v_doc;
INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
VALUES (v_org_id, auth.uid(), 'month_end_documents', p_doc_id::text, 'REOPEN',
jsonb_build_object('old_status', 'finalized', 'reason', p_reason), jsonb_build_object('new_status', 'posted'), ARRAY['status']);
RETURN v_doc;
END;
$function$
;

-- public.reopen_month_end(p_doc_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION public.reopen_month_end(p_doc_id uuid, p_reason text)
 RETURNS month_end_documents
 LANGUAGE sql
 SET search_path TO ''
AS $function$
SELECT internal.reopen_month_end(p_doc_id, p_reason);
$function$
;


-- ============ Triggers (99) ============

-- public.accounting_periods.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.accounting_periods FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.accounting_periods.audit_log_accounting_periods
CREATE TRIGGER audit_log_accounting_periods AFTER INSERT OR DELETE OR UPDATE ON public.accounting_periods FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.accounting_periods.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.accounting_periods FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.accounting_periods.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.accounting_periods FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.accounting_policy_elections.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.accounting_policy_elections FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.accounting_policy_elections.aa_approval_workflow
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.accounting_policy_elections FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- public.accounting_policy_elections.enforce_policy_election_rules
CREATE TRIGGER enforce_policy_election_rules BEFORE INSERT OR UPDATE ON public.accounting_policy_elections FOR EACH ROW EXECUTE FUNCTION internal.enforce_policy_election_rules();

-- public.accounting_policy_elections.write_audit_log
CREATE TRIGGER write_audit_log AFTER INSERT OR DELETE OR UPDATE ON public.accounting_policy_elections FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.amortization_schedules.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.amortization_schedules FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.amortization_schedules.audit_log_amortization_schedules
CREATE TRIGGER audit_log_amortization_schedules AFTER INSERT OR DELETE OR UPDATE ON public.amortization_schedules FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.amortization_schedules.prevent_locked_amortization_mutation
CREATE TRIGGER prevent_locked_amortization_mutation BEFORE DELETE OR UPDATE ON public.amortization_schedules FOR EACH ROW EXECUTE FUNCTION internal.prevent_locked_amortization_mutation();

-- public.approval_settings.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.approval_settings FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.approval_settings.audit_approval_settings
CREATE TRIGGER audit_approval_settings AFTER INSERT OR UPDATE ON public.approval_settings FOR EACH ROW EXECUTE FUNCTION internal.audit_approval_settings();

-- public.approval_settings.validate_approval_settings
CREATE TRIGGER validate_approval_settings BEFORE INSERT OR UPDATE ON public.approval_settings FOR EACH ROW EXECUTE FUNCTION internal.validate_approval_settings();

-- public.audit_log.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.audit_log.prevent_audit_log_mutation
CREATE TRIGGER prevent_audit_log_mutation BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION internal.prevent_audit_log_mutation();

-- public.branches.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.branches.audit_log_branches
CREATE TRIGGER audit_log_branches AFTER INSERT OR DELETE OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.branches.enforce_plan_feature_branches
CREATE TRIGGER enforce_plan_feature_branches BEFORE INSERT OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- public.companies.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.companies.audit_log_companies
CREATE TRIGGER audit_log_companies AFTER INSERT OR DELETE OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.contract_cancellations.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.contract_cancellations.aa_approval_workflow
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- public.contract_cancellations.audit_log_contract_cancellations
CREATE TRIGGER audit_log_contract_cancellations AFTER INSERT OR DELETE OR UPDATE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.contract_cancellations.enforce_plan_feature_contract_cancellations
CREATE TRIGGER enforce_plan_feature_contract_cancellations BEFORE INSERT OR UPDATE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- public.contract_cancellations.trg_prevent_delete_posted_cancellation
CREATE TRIGGER trg_prevent_delete_posted_cancellation BEFORE DELETE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION internal.prevent_delete_posted_contract_change();

-- public.contract_cancellations.update_contract_cancellations_updated_at
CREATE TRIGGER update_contract_cancellations_updated_at BEFORE UPDATE ON public.contract_cancellations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.contract_modifications.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.contract_modifications.aa_approval_workflow
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- public.contract_modifications.audit_log_contract_modifications
CREATE TRIGGER audit_log_contract_modifications AFTER INSERT OR DELETE OR UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.contract_modifications.enforce_plan_feature_contract_modifications
CREATE TRIGGER enforce_plan_feature_contract_modifications BEFORE INSERT OR UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- public.contract_modifications.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.contract_modifications.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.contract_modifications.trg_prevent_delete_posted_modification
CREATE TRIGGER trg_prevent_delete_posted_modification BEFORE DELETE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION internal.prevent_delete_posted_contract_change();

-- public.contract_modifications.update_contract_modifications_updated_at
CREATE TRIGGER update_contract_modifications_updated_at BEFORE UPDATE ON public.contract_modifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.documents.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.documents.audit_log_documents
CREATE TRIGGER audit_log_documents AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.documents.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.documents.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.documents.update_documents_updated_at
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.error_logs.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.error_logs FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.fixed_asset_types.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.fixed_asset_types FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.fixed_asset_types.audit_log_fixed_asset_types
CREATE TRIGGER audit_log_fixed_asset_types AFTER INSERT OR DELETE OR UPDATE ON public.fixed_asset_types FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.journal_entries.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.journal_entries.audit_log_journal_entries
CREATE TRIGGER audit_log_journal_entries AFTER INSERT OR DELETE OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.journal_entries.prevent_period_locked_je_delete
CREATE TRIGGER prevent_period_locked_je_delete BEFORE DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_je();

-- public.journal_entries.prevent_period_locked_je_update
CREATE TRIGGER prevent_period_locked_je_update BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_je();

-- public.lease_impairments.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lease_impairments FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lease_impairments.aa_approval_workflow
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.lease_impairments FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- public.lease_impairments.audit_log_lease_impairments
CREATE TRIGGER audit_log_lease_impairments AFTER INSERT OR DELETE OR UPDATE ON public.lease_impairments FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.lease_impairments.enforce_plan_feature_lease_impairments
CREATE TRIGGER enforce_plan_feature_lease_impairments BEFORE INSERT OR UPDATE ON public.lease_impairments FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- public.lease_modifications.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lease_modifications FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lease_modifications.audit_log_lease_modifications
CREATE TRIGGER audit_log_lease_modifications AFTER INSERT OR DELETE OR UPDATE ON public.lease_modifications FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.lease_payment_schedules.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lease_payment_schedules FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lease_payment_schedules.audit_log_lease_payment_schedules
CREATE TRIGGER audit_log_lease_payment_schedules AFTER INSERT OR DELETE OR UPDATE ON public.lease_payment_schedules FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.lease_payment_schedules.prevent_locked_payment_schedule_mutation
CREATE TRIGGER prevent_locked_payment_schedule_mutation BEFORE DELETE OR UPDATE ON public.lease_payment_schedules FOR EACH ROW EXECUTE FUNCTION internal.prevent_locked_payment_schedule_mutation();

-- public.lease_payments.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lease_payments FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lease_payments.audit_log_lease_payments
CREATE TRIGGER audit_log_lease_payments AFTER INSERT OR DELETE OR UPDATE ON public.lease_payments FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.lease_transactions.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lease_transactions FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lease_transactions.audit_log_lease_transactions
CREATE TRIGGER audit_log_lease_transactions AFTER INSERT OR DELETE OR UPDATE ON public.lease_transactions FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.lease_transactions.prevent_period_locked_lt_delete
CREATE TRIGGER prevent_period_locked_lt_delete BEFORE DELETE ON public.lease_transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_lt();

-- public.lease_transactions.prevent_period_locked_lt_update
CREATE TRIGGER prevent_period_locked_lt_update BEFORE UPDATE ON public.lease_transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_lt();

-- public.lease_transactions.prevent_zero_amount_recognition_lt
CREATE TRIGGER prevent_zero_amount_recognition_lt BEFORE INSERT OR UPDATE ON public.lease_transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_zero_amount_recognition();

-- public.leases.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.leases.audit_log_leases
CREATE TRIGGER audit_log_leases AFTER INSERT OR DELETE OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.leases.enforce_lease_limit
CREATE TRIGGER enforce_lease_limit BEFORE INSERT ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.enforce_lease_limit();

-- public.leases.prevent_posted_lease_delete
CREATE TRIGGER prevent_posted_lease_delete BEFORE DELETE ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_lease_delete();

-- public.leases.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.leases.require_finance_classification_inputs
CREATE TRIGGER require_finance_classification_inputs BEFORE INSERT OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.require_finance_classification_inputs();

-- public.leases.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.leases FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.leases.update_leases_updated_at
CREATE TRIGGER update_leases_updated_at BEFORE UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.lessors.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.lessors FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.lessors.audit_log_lessors
CREATE TRIGGER audit_log_lessors AFTER INSERT OR DELETE OR UPDATE ON public.lessors FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.month_end_documents.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.month_end_documents.aa_approval_workflow
CREATE TRIGGER aa_approval_workflow BEFORE INSERT OR UPDATE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.apply_approval_workflow();

-- public.month_end_documents.ab_enforce_month_end_order
CREATE TRIGGER ab_enforce_month_end_order BEFORE INSERT OR UPDATE OF status ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.enforce_month_end_order();

-- public.month_end_documents.audit_log_month_end_documents
CREATE TRIGGER audit_log_month_end_documents AFTER INSERT OR DELETE OR UPDATE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.month_end_documents.post_month_end_entries
CREATE TRIGGER post_month_end_entries AFTER INSERT OR UPDATE OF status ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.post_month_end_entries();

-- public.month_end_documents.prevent_month_end_delete
CREATE TRIGGER prevent_month_end_delete BEFORE DELETE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.prevent_month_end_mutation();

-- public.month_end_documents.prevent_month_end_update
CREATE TRIGGER prevent_month_end_update BEFORE UPDATE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.prevent_month_end_mutation();

-- public.month_end_documents.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.month_end_documents.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.month_end_documents.sync_accounting_period_lock
CREATE TRIGGER sync_accounting_period_lock AFTER INSERT OR DELETE OR UPDATE OF status ON public.month_end_documents FOR EACH ROW EXECUTE FUNCTION internal.sync_accounting_period_lock();

-- public.organizations.audit_log_organizations
CREATE TRIGGER audit_log_organizations AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.organizations.create_default_approval_settings
CREATE TRIGGER create_default_approval_settings AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION internal.create_default_approval_settings();

-- public.subscription_plans.audit_log_subscription_plans
CREATE TRIGGER audit_log_subscription_plans AFTER INSERT OR DELETE OR UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.subscriptions.audit_log_subscriptions
CREATE TRIGGER audit_log_subscriptions AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.transactions.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.transactions.audit_log_transactions
CREATE TRIGGER audit_log_transactions AFTER INSERT OR DELETE OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.transactions.prevent_posted_transaction_delete
CREATE TRIGGER prevent_posted_transaction_delete BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_transaction_mutation();

-- public.transactions.prevent_posted_transaction_update
CREATE TRIGGER prevent_posted_transaction_update BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_transaction_mutation();

-- public.transactions.prevent_user_id_change
CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();

-- public.transactions.set_user_id
CREATE TRIGGER set_user_id BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION internal.set_user_id();

-- public.transactions.update_transactions_updated_at
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- public.user_activity_logs.a00_set_organization_id
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.user_activity_logs FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- public.user_profiles.audit_log_user_profiles
CREATE TRIGGER audit_log_user_profiles AFTER INSERT OR DELETE OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- public.user_profiles.enforce_plan_feature_user_profiles
CREATE TRIGGER enforce_plan_feature_user_profiles BEFORE INSERT ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION internal.enforce_plan_feature();

-- public.user_profiles.enforce_role_permissions_guard
CREATE TRIGGER enforce_role_permissions_guard BEFORE INSERT OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION internal.enforce_role_permissions_guard();

-- public.user_profiles.update_user_profiles_updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============ Row level security (32) ============

-- internal.platform_admins
ALTER TABLE internal.platform_admins ENABLE ROW LEVEL SECURITY;

-- public.accounting_periods
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

-- public.accounting_policy_elections
ALTER TABLE public.accounting_policy_elections ENABLE ROW LEVEL SECURITY;

-- public.amortization_schedules
ALTER TABLE public.amortization_schedules ENABLE ROW LEVEL SECURITY;

-- public.approval_settings
ALTER TABLE public.approval_settings ENABLE ROW LEVEL SECURITY;

-- public.audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- public.branches
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- public.companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- public.contract_cancellations
ALTER TABLE public.contract_cancellations ENABLE ROW LEVEL SECURITY;

-- public.contract_modifications
ALTER TABLE public.contract_modifications ENABLE ROW LEVEL SECURITY;

-- public.documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- public.error_logs
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- public.fixed_asset_types
ALTER TABLE public.fixed_asset_types ENABLE ROW LEVEL SECURITY;

-- public.journal_entries
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

-- public.lease_impairments
ALTER TABLE public.lease_impairments ENABLE ROW LEVEL SECURITY;

-- public.lease_modifications
ALTER TABLE public.lease_modifications ENABLE ROW LEVEL SECURITY;

-- public.lease_payment_schedules
ALTER TABLE public.lease_payment_schedules ENABLE ROW LEVEL SECURITY;

-- public.lease_payments
ALTER TABLE public.lease_payments ENABLE ROW LEVEL SECURITY;

-- public.lease_transactions
ALTER TABLE public.lease_transactions ENABLE ROW LEVEL SECURITY;

-- public.leases
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

-- public.lessors
ALTER TABLE public.lessors ENABLE ROW LEVEL SECURITY;

-- public.month_end_documents
ALTER TABLE public.month_end_documents ENABLE ROW LEVEL SECURITY;

-- public.organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- public.stripe_customers
ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;

-- public.stripe_orders
ALTER TABLE public.stripe_orders ENABLE ROW LEVEL SECURITY;

-- public.stripe_processed_events
ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;

-- public.stripe_subscriptions
ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;

-- public.subscription_plans
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- public.subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- public.transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- public.user_activity_logs
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- public.user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;


-- ============ Policies (174) ============

-- public.accounting_periods.consolidated_delete_accounting_periods
CREATE POLICY consolidated_delete_accounting_periods ON public.accounting_periods AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.accounting_periods.consolidated_insert_accounting_periods
CREATE POLICY consolidated_insert_accounting_periods ON public.accounting_periods AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.accounting_periods.consolidated_select_accounting_periods
CREATE POLICY consolidated_select_accounting_periods ON public.accounting_periods AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.accounting_periods.consolidated_update_accounting_periods
CREATE POLICY consolidated_update_accounting_periods ON public.accounting_periods AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.accounting_periods.subscription_required_delete_accounting_periods
CREATE POLICY subscription_required_delete_accounting_periods ON public.accounting_periods AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_periods.subscription_required_insert_accounting_periods
CREATE POLICY subscription_required_insert_accounting_periods ON public.accounting_periods AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_periods.subscription_required_update_accounting_periods
CREATE POLICY subscription_required_update_accounting_periods ON public.accounting_periods AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_periods.tenant_isolation_accounting_periods
CREATE POLICY tenant_isolation_accounting_periods ON public.accounting_periods AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.accounting_policy_elections.insert_policy_elections
CREATE POLICY insert_policy_elections ON public.accounting_policy_elections AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin));

-- public.accounting_policy_elections.select_policy_elections
CREATE POLICY select_policy_elections ON public.accounting_policy_elections AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT internal.is_manage_or_admin() AS is_manage_or_admin) OR (prepared_by = auth.uid()) OR (created_by = auth.uid())));

-- public.accounting_policy_elections.subscription_required_delete_accounting_policy_elections
CREATE POLICY subscription_required_delete_accounting_policy_elections ON public.accounting_policy_elections AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_policy_elections.subscription_required_insert_accounting_policy_elections
CREATE POLICY subscription_required_insert_accounting_policy_elections ON public.accounting_policy_elections AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_policy_elections.subscription_required_update_accounting_policy_elections
CREATE POLICY subscription_required_update_accounting_policy_elections ON public.accounting_policy_elections AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.accounting_policy_elections.tenant_isolation_accounting_policy_elections
CREATE POLICY tenant_isolation_accounting_policy_elections ON public.accounting_policy_elections AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.accounting_policy_elections.update_policy_elections
CREATE POLICY update_policy_elections ON public.accounting_policy_elections AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin))
  WITH CHECK (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin));

-- public.amortization_schedules.consolidated_delete_amortization_schedules
CREATE POLICY consolidated_delete_amortization_schedules ON public.amortization_schedules AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.amortization_schedules.consolidated_insert_amortization_schedules
CREATE POLICY consolidated_insert_amortization_schedules ON public.amortization_schedules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.amortization_schedules.consolidated_select_amortization_schedules
CREATE POLICY consolidated_select_amortization_schedules ON public.amortization_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.amortization_schedules.consolidated_update_amortization_schedules
CREATE POLICY consolidated_update_amortization_schedules ON public.amortization_schedules AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.amortization_schedules.subscription_required_delete_amortization_schedules
CREATE POLICY subscription_required_delete_amortization_schedules ON public.amortization_schedules AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.amortization_schedules.subscription_required_insert_amortization_schedules
CREATE POLICY subscription_required_insert_amortization_schedules ON public.amortization_schedules AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.amortization_schedules.subscription_required_update_amortization_schedules
CREATE POLICY subscription_required_update_amortization_schedules ON public.amortization_schedules AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.amortization_schedules.tenant_isolation_amortization_schedules
CREATE POLICY tenant_isolation_amortization_schedules ON public.amortization_schedules AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.approval_settings.admins_insert_approval_settings
CREATE POLICY admins_insert_approval_settings ON public.approval_settings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) AND ( SELECT internal.is_admin() AS is_admin)));

-- public.approval_settings.admins_update_approval_settings
CREATE POLICY admins_update_approval_settings ON public.approval_settings AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) AND ( SELECT internal.is_admin() AS is_admin)))
  WITH CHECK (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) AND ( SELECT internal.is_admin() AS is_admin)));

-- public.approval_settings.members_read_approval_settings
CREATE POLICY members_read_approval_settings ON public.approval_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.audit_log.audit_log_select_admin
CREATE POLICY audit_log_select_admin ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (((organization_id = internal.current_org_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text) AND (user_profiles.organization_id = audit_log.organization_id))))));

-- public.branches.consolidated_delete_branches
CREATE POLICY consolidated_delete_branches ON public.branches AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.branches.consolidated_insert_branches
CREATE POLICY consolidated_insert_branches ON public.branches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.branches.consolidated_select_branches
CREATE POLICY consolidated_select_branches ON public.branches AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.branches.consolidated_update_branches
CREATE POLICY consolidated_update_branches ON public.branches AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.branches.subscription_required_delete_branches
CREATE POLICY subscription_required_delete_branches ON public.branches AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.branches.subscription_required_insert_branches
CREATE POLICY subscription_required_insert_branches ON public.branches AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.branches.subscription_required_update_branches
CREATE POLICY subscription_required_update_branches ON public.branches AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.branches.tenant_isolation_branches
CREATE POLICY tenant_isolation_branches ON public.branches AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.companies.consolidated_select_companies
CREATE POLICY consolidated_select_companies ON public.companies AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.companies.delete_own_companies
CREATE POLICY delete_own_companies ON public.companies AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.companies.insert_own_companies
CREATE POLICY insert_own_companies ON public.companies AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.companies.subscription_required_delete_companies
CREATE POLICY subscription_required_delete_companies ON public.companies AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.companies.subscription_required_insert_companies
CREATE POLICY subscription_required_insert_companies ON public.companies AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.companies.subscription_required_update_companies
CREATE POLICY subscription_required_update_companies ON public.companies AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.companies.tenant_isolation_companies
CREATE POLICY tenant_isolation_companies ON public.companies AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.companies.update_own_companies
CREATE POLICY update_own_companies ON public.companies AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.contract_cancellations.consolidated_delete_contract_cancellations
CREATE POLICY consolidated_delete_contract_cancellations ON public.contract_cancellations AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.contract_cancellations.consolidated_insert_contract_cancellations
CREATE POLICY consolidated_insert_contract_cancellations ON public.contract_cancellations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.contract_cancellations.consolidated_select_contract_cancellations
CREATE POLICY consolidated_select_contract_cancellations ON public.contract_cancellations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.contract_cancellations.consolidated_update_contract_cancellations
CREATE POLICY consolidated_update_contract_cancellations ON public.contract_cancellations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.contract_cancellations.subscription_required_delete_contract_cancellations
CREATE POLICY subscription_required_delete_contract_cancellations ON public.contract_cancellations AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_cancellations.subscription_required_insert_contract_cancellations
CREATE POLICY subscription_required_insert_contract_cancellations ON public.contract_cancellations AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_cancellations.subscription_required_update_contract_cancellations
CREATE POLICY subscription_required_update_contract_cancellations ON public.contract_cancellations AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_cancellations.tenant_isolation_contract_cancellations
CREATE POLICY tenant_isolation_contract_cancellations ON public.contract_cancellations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.contract_modifications.consolidated_delete_contract_modifications
CREATE POLICY consolidated_delete_contract_modifications ON public.contract_modifications AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.contract_modifications.consolidated_insert_contract_modifications
CREATE POLICY consolidated_insert_contract_modifications ON public.contract_modifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.contract_modifications.consolidated_select_contract_modifications
CREATE POLICY consolidated_select_contract_modifications ON public.contract_modifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.contract_modifications.consolidated_update_contract_modifications
CREATE POLICY consolidated_update_contract_modifications ON public.contract_modifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.contract_modifications.subscription_required_delete_contract_modifications
CREATE POLICY subscription_required_delete_contract_modifications ON public.contract_modifications AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_modifications.subscription_required_insert_contract_modifications
CREATE POLICY subscription_required_insert_contract_modifications ON public.contract_modifications AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_modifications.subscription_required_update_contract_modifications
CREATE POLICY subscription_required_update_contract_modifications ON public.contract_modifications AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.contract_modifications.tenant_isolation_contract_modifications
CREATE POLICY tenant_isolation_contract_modifications ON public.contract_modifications AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.documents.consolidated_delete_documents
CREATE POLICY consolidated_delete_documents ON public.documents AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.documents.consolidated_insert_documents
CREATE POLICY consolidated_insert_documents ON public.documents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.documents.consolidated_select_documents
CREATE POLICY consolidated_select_documents ON public.documents AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.documents.consolidated_update_documents
CREATE POLICY consolidated_update_documents ON public.documents AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.documents.subscription_required_delete_documents
CREATE POLICY subscription_required_delete_documents ON public.documents AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.documents.subscription_required_insert_documents
CREATE POLICY subscription_required_insert_documents ON public.documents AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.documents.subscription_required_update_documents
CREATE POLICY subscription_required_update_documents ON public.documents AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.documents.tenant_isolation_documents
CREATE POLICY tenant_isolation_documents ON public.documents AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.error_logs.error_logs_insert_own
CREATE POLICY error_logs_insert_own ON public.error_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (organization_id = internal.current_org_id())));

-- public.error_logs.error_logs_select_admin
CREATE POLICY error_logs_select_admin ON public.error_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((organization_id = internal.current_org_id()) AND (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text) AND (user_profiles.organization_id = error_logs.organization_id))))));

-- public.fixed_asset_types.Users can delete own fixed_asset_types
CREATE POLICY "Users can delete own fixed_asset_types" ON public.fixed_asset_types AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.fixed_asset_types.Users can insert own fixed_asset_types
CREATE POLICY "Users can insert own fixed_asset_types" ON public.fixed_asset_types AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.fixed_asset_types.Users can update own fixed_asset_types
CREATE POLICY "Users can update own fixed_asset_types" ON public.fixed_asset_types AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.fixed_asset_types.consolidated_select_fixed_asset_types
CREATE POLICY consolidated_select_fixed_asset_types ON public.fixed_asset_types AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.fixed_asset_types.subscription_required_delete_fixed_asset_types
CREATE POLICY subscription_required_delete_fixed_asset_types ON public.fixed_asset_types AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.fixed_asset_types.subscription_required_insert_fixed_asset_types
CREATE POLICY subscription_required_insert_fixed_asset_types ON public.fixed_asset_types AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.fixed_asset_types.subscription_required_update_fixed_asset_types
CREATE POLICY subscription_required_update_fixed_asset_types ON public.fixed_asset_types AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.fixed_asset_types.tenant_isolation_fixed_asset_types
CREATE POLICY tenant_isolation_fixed_asset_types ON public.fixed_asset_types AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.journal_entries.Users can delete entries for own leases
CREATE POLICY "Users can delete entries for own leases" ON public.journal_entries AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.journal_entries.Users can insert entries for own leases
CREATE POLICY "Users can insert entries for own leases" ON public.journal_entries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.journal_entries.Users can update entries for own leases
CREATE POLICY "Users can update entries for own leases" ON public.journal_entries AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.journal_entries.consolidated_select_journal_entries
CREATE POLICY consolidated_select_journal_entries ON public.journal_entries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.journal_entries.subscription_required_delete_journal_entries
CREATE POLICY subscription_required_delete_journal_entries ON public.journal_entries AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.journal_entries.subscription_required_insert_journal_entries
CREATE POLICY subscription_required_insert_journal_entries ON public.journal_entries AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.journal_entries.subscription_required_update_journal_entries
CREATE POLICY subscription_required_update_journal_entries ON public.journal_entries AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.journal_entries.tenant_isolation_journal_entries
CREATE POLICY tenant_isolation_journal_entries ON public.journal_entries AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lease_impairments.consolidated_delete_lease_impairments
CREATE POLICY consolidated_delete_lease_impairments ON public.lease_impairments AS PERMISSIVE FOR DELETE TO authenticated
  USING ((internal.is_manage_or_admin() OR (( SELECT auth.uid() AS uid) = ( SELECT leases.user_id
   FROM leases
  WHERE (leases.id = lease_impairments.lease_id)))));

-- public.lease_impairments.consolidated_insert_lease_impairments
CREATE POLICY consolidated_insert_lease_impairments ON public.lease_impairments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((internal.is_manage_or_admin() OR (( SELECT auth.uid() AS uid) = ( SELECT leases.user_id
   FROM leases
  WHERE (leases.id = lease_impairments.lease_id)))));

-- public.lease_impairments.consolidated_select_lease_impairments
CREATE POLICY consolidated_select_lease_impairments ON public.lease_impairments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = ( SELECT leases.user_id
   FROM leases
  WHERE (leases.id = lease_impairments.lease_id)))));

-- public.lease_impairments.consolidated_update_lease_impairments
CREATE POLICY consolidated_update_lease_impairments ON public.lease_impairments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() OR (( SELECT auth.uid() AS uid) = ( SELECT leases.user_id
   FROM leases
  WHERE (leases.id = lease_impairments.lease_id)))))
  WITH CHECK ((internal.is_manage_or_admin() OR (( SELECT auth.uid() AS uid) = ( SELECT leases.user_id
   FROM leases
  WHERE (leases.id = lease_impairments.lease_id)))));

-- public.lease_impairments.subscription_required_delete_lease_impairments
CREATE POLICY subscription_required_delete_lease_impairments ON public.lease_impairments AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_impairments.subscription_required_insert_lease_impairments
CREATE POLICY subscription_required_insert_lease_impairments ON public.lease_impairments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_impairments.subscription_required_update_lease_impairments
CREATE POLICY subscription_required_update_lease_impairments ON public.lease_impairments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_impairments.tenant_isolation_lease_impairments
CREATE POLICY tenant_isolation_lease_impairments ON public.lease_impairments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lease_modifications.consolidated_delete_lease_modifications
CREATE POLICY consolidated_delete_lease_modifications ON public.lease_modifications AS PERMISSIVE FOR DELETE TO authenticated
  USING ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_modifications.consolidated_insert_lease_modifications
CREATE POLICY consolidated_insert_lease_modifications ON public.lease_modifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_modifications.consolidated_select_lease_modifications
CREATE POLICY consolidated_select_lease_modifications ON public.lease_modifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_modifications.consolidated_update_lease_modifications
CREATE POLICY consolidated_update_lease_modifications ON public.lease_modifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_modifications.subscription_required_delete_lease_modifications
CREATE POLICY subscription_required_delete_lease_modifications ON public.lease_modifications AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_modifications.subscription_required_insert_lease_modifications
CREATE POLICY subscription_required_insert_lease_modifications ON public.lease_modifications AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_modifications.subscription_required_update_lease_modifications
CREATE POLICY subscription_required_update_lease_modifications ON public.lease_modifications AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_modifications.tenant_isolation_lease_modifications
CREATE POLICY tenant_isolation_lease_modifications ON public.lease_modifications AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lease_payment_schedules.consolidated_delete_lease_payment_schedules
CREATE POLICY consolidated_delete_lease_payment_schedules ON public.lease_payment_schedules AS PERMISSIVE FOR DELETE TO authenticated
  USING ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_payment_schedules.consolidated_insert_lease_payment_schedules
CREATE POLICY consolidated_insert_lease_payment_schedules ON public.lease_payment_schedules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_payment_schedules.consolidated_select_lease_payment_schedules
CREATE POLICY consolidated_select_lease_payment_schedules ON public.lease_payment_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))) OR internal.has_data_access()));

-- public.lease_payment_schedules.consolidated_update_lease_payment_schedules
CREATE POLICY consolidated_update_lease_payment_schedules ON public.lease_payment_schedules AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_payment_schedules.subscription_required_delete_lease_payment_schedules
CREATE POLICY subscription_required_delete_lease_payment_schedules ON public.lease_payment_schedules AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payment_schedules.subscription_required_insert_lease_payment_schedules
CREATE POLICY subscription_required_insert_lease_payment_schedules ON public.lease_payment_schedules AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payment_schedules.subscription_required_update_lease_payment_schedules
CREATE POLICY subscription_required_update_lease_payment_schedules ON public.lease_payment_schedules AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payment_schedules.tenant_isolation_lease_payment_schedules
CREATE POLICY tenant_isolation_lease_payment_schedules ON public.lease_payment_schedules AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lease_payments.Users can delete payments for own leases
CREATE POLICY "Users can delete payments for own leases" ON public.lease_payments AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.lease_payments.Users can insert payments for own leases
CREATE POLICY "Users can insert payments for own leases" ON public.lease_payments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.lease_payments.Users can update payments for own leases
CREATE POLICY "Users can update payments for own leases" ON public.lease_payments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))));

-- public.lease_payments.consolidated_select_lease_payments
CREATE POLICY consolidated_select_lease_payments ON public.lease_payments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_payments.subscription_required_delete_lease_payments
CREATE POLICY subscription_required_delete_lease_payments ON public.lease_payments AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payments.subscription_required_insert_lease_payments
CREATE POLICY subscription_required_insert_lease_payments ON public.lease_payments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payments.subscription_required_update_lease_payments
CREATE POLICY subscription_required_update_lease_payments ON public.lease_payments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_payments.tenant_isolation_lease_payments
CREATE POLICY tenant_isolation_lease_payments ON public.lease_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lease_transactions.consolidated_delete_lease_transactions
CREATE POLICY consolidated_delete_lease_transactions ON public.lease_transactions AS PERMISSIVE FOR DELETE TO authenticated
  USING ((internal.is_manage_or_admin() OR ((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))));

-- public.lease_transactions.consolidated_insert_lease_transactions
CREATE POLICY consolidated_insert_lease_transactions ON public.lease_transactions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((internal.is_manage_or_admin() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_transactions.consolidated_select_lease_transactions
CREATE POLICY consolidated_select_lease_transactions ON public.lease_transactions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.lease_transactions.consolidated_update_lease_transactions
CREATE POLICY consolidated_update_lease_transactions ON public.lease_transactions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() OR ((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))))
  WITH CHECK ((internal.is_manage_or_admin() OR ((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))));

-- public.lease_transactions.subscription_required_delete_lease_transactions
CREATE POLICY subscription_required_delete_lease_transactions ON public.lease_transactions AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_transactions.subscription_required_insert_lease_transactions
CREATE POLICY subscription_required_insert_lease_transactions ON public.lease_transactions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_transactions.subscription_required_update_lease_transactions
CREATE POLICY subscription_required_update_lease_transactions ON public.lease_transactions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lease_transactions.tenant_isolation_lease_transactions
CREATE POLICY tenant_isolation_lease_transactions ON public.lease_transactions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.leases.consolidated_delete_leases
CREATE POLICY consolidated_delete_leases ON public.leases AS PERMISSIVE FOR DELETE TO authenticated
  USING ((internal.is_manage_or_admin() AND internal.has_permission('delete_leases'::text)));

-- public.leases.consolidated_insert_leases
CREATE POLICY consolidated_insert_leases ON public.leases AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'::text)));

-- public.leases.consolidated_select_leases
CREATE POLICY consolidated_select_leases ON public.leases AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.leases.consolidated_update_leases
CREATE POLICY consolidated_update_leases ON public.leases AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'::text)))
  WITH CHECK ((internal.is_manage_or_admin() AND internal.has_permission('create_edit_leases'::text)));

-- public.leases.subscription_required_delete_leases
CREATE POLICY subscription_required_delete_leases ON public.leases AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.leases.subscription_required_insert_leases
CREATE POLICY subscription_required_insert_leases ON public.leases AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.leases.subscription_required_update_leases
CREATE POLICY subscription_required_update_leases ON public.leases AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.leases.tenant_isolation_leases
CREATE POLICY tenant_isolation_leases ON public.leases AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lessors.delete_lessors
CREATE POLICY delete_lessors ON public.lessors AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin));

-- public.lessors.insert_lessors
CREATE POLICY insert_lessors ON public.lessors AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin));

-- public.lessors.subscription_required_delete_lessors
CREATE POLICY subscription_required_delete_lessors ON public.lessors AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lessors.subscription_required_insert_lessors
CREATE POLICY subscription_required_insert_lessors ON public.lessors AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lessors.subscription_required_update_lessors
CREATE POLICY subscription_required_update_lessors ON public.lessors AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.lessors.tenant_isolation_lessors
CREATE POLICY tenant_isolation_lessors ON public.lessors AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lessors.tenant_select_lessors
CREATE POLICY tenant_select_lessors ON public.lessors AS PERMISSIVE FOR SELECT TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.lessors.update_lessors
CREATE POLICY update_lessors ON public.lessors AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin))
  WITH CHECK (( SELECT internal.is_manage_or_admin() AS is_manage_or_admin));

-- public.month_end_documents.consolidated_delete_month_end_documents
CREATE POLICY consolidated_delete_month_end_documents ON public.month_end_documents AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.month_end_documents.consolidated_insert_month_end_documents
CREATE POLICY consolidated_insert_month_end_documents ON public.month_end_documents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.month_end_documents.consolidated_select_month_end_documents
CREATE POLICY consolidated_select_month_end_documents ON public.month_end_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.month_end_documents.consolidated_update_month_end_documents
CREATE POLICY consolidated_update_month_end_documents ON public.month_end_documents AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.month_end_documents.subscription_required_delete_month_end_documents
CREATE POLICY subscription_required_delete_month_end_documents ON public.month_end_documents AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.month_end_documents.subscription_required_insert_month_end_documents
CREATE POLICY subscription_required_insert_month_end_documents ON public.month_end_documents AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.month_end_documents.subscription_required_update_month_end_documents
CREATE POLICY subscription_required_update_month_end_documents ON public.month_end_documents AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.month_end_documents.tenant_isolation_month_end_documents
CREATE POLICY tenant_isolation_month_end_documents ON public.month_end_documents AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.organizations.Members can view own organization
CREATE POLICY "Members can view own organization" ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.stripe_customers.Users can view their own customer data
CREATE POLICY "Users can view their own customer data" ON public.stripe_customers AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL)));

-- public.stripe_orders.Users can view their own order data
CREATE POLICY "Users can view their own order data" ON public.stripe_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING (((customer_id IN ( SELECT stripe_customers.customer_id
   FROM stripe_customers
  WHERE ((stripe_customers.user_id = ( SELECT auth.uid() AS uid)) AND (stripe_customers.deleted_at IS NULL)))) AND (deleted_at IS NULL)));

-- public.stripe_subscriptions.Users can view their own subscription data
CREATE POLICY "Users can view their own subscription data" ON public.stripe_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((customer_id IN ( SELECT stripe_customers.customer_id
   FROM stripe_customers
  WHERE ((stripe_customers.user_id = ( SELECT auth.uid() AS uid)) AND (stripe_customers.deleted_at IS NULL)))) AND (deleted_at IS NULL)));

-- public.subscription_plans.plans_public_read
CREATE POLICY plans_public_read ON public.subscription_plans AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

-- public.subscriptions.select_own_org_subscription
CREATE POLICY select_own_org_subscription ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.transactions.consolidated_delete_transactions
CREATE POLICY consolidated_delete_transactions ON public.transactions AS PERMISSIVE FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- public.transactions.consolidated_insert_transactions
CREATE POLICY consolidated_insert_transactions ON public.transactions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

-- public.transactions.consolidated_select_transactions
CREATE POLICY consolidated_select_transactions ON public.transactions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.has_data_access() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.transactions.consolidated_update_transactions
CREATE POLICY consolidated_update_transactions ON public.transactions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

-- public.transactions.subscription_required_delete_transactions
CREATE POLICY subscription_required_delete_transactions ON public.transactions AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.transactions.subscription_required_insert_transactions
CREATE POLICY subscription_required_insert_transactions ON public.transactions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.transactions.subscription_required_update_transactions
CREATE POLICY subscription_required_update_transactions ON public.transactions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.transactions.tenant_isolation_transactions
CREATE POLICY tenant_isolation_transactions ON public.transactions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.user_activity_logs.Users can insert own activity logs
CREATE POLICY "Users can insert own activity logs" ON public.user_activity_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

-- public.user_activity_logs.Users can view own activity logs
CREATE POLICY "Users can view own activity logs" ON public.user_activity_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

-- public.user_activity_logs.subscription_required_delete_user_activity_logs
CREATE POLICY subscription_required_delete_user_activity_logs ON public.user_activity_logs AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.user_activity_logs.subscription_required_insert_user_activity_logs
CREATE POLICY subscription_required_insert_user_activity_logs ON public.user_activity_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.user_activity_logs.subscription_required_update_user_activity_logs
CREATE POLICY subscription_required_update_user_activity_logs ON public.user_activity_logs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)))
  WITH CHECK ((( SELECT internal.org_has_active_subscription() AS org_has_active_subscription) OR ( SELECT internal.is_platform_admin() AS is_platform_admin)));

-- public.user_activity_logs.tenant_isolation_user_activity_logs
CREATE POLICY tenant_isolation_user_activity_logs ON public.user_activity_logs AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)))
  WITH CHECK ((organization_id = ( SELECT internal.current_org_id() AS current_org_id)));

-- public.user_profiles.consolidated_delete_user_profiles
CREATE POLICY consolidated_delete_user_profiles ON public.user_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING (((internal.is_admin() AND (user_id <> ( SELECT auth.uid() AS uid))) OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.user_profiles.consolidated_select_user_profiles
CREATE POLICY consolidated_select_user_profiles ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((internal.is_admin() OR internal.is_manage_or_admin() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.user_profiles.consolidated_update_user_profiles
CREATE POLICY consolidated_update_user_profiles ON public.user_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((internal.is_admin() OR (( SELECT auth.uid() AS uid) = user_id)))
  WITH CHECK ((internal.is_admin() OR (( SELECT auth.uid() AS uid) = user_id)));

-- public.user_profiles.tenant_insert_user_profiles
CREATE POLICY tenant_insert_user_profiles ON public.user_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR internal.is_admin())));

-- public.user_profiles.tenant_isolation_user_profiles
CREATE POLICY tenant_isolation_user_profiles ON public.user_profiles AS RESTRICTIVE FOR ALL TO authenticated
  USING (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) OR (user_id = ( SELECT auth.uid() AS uid))))
  WITH CHECK (((organization_id = ( SELECT internal.current_org_id() AS current_org_id)) OR (user_id = ( SELECT auth.uid() AS uid))));


-- ============ Table grants (68) ============

-- public.accounting_periods.authenticated
GRANT SELECT ON public.accounting_periods TO authenticated;

-- public.accounting_periods.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounting_periods TO service_role;

-- public.accounting_policy_elections.authenticated
GRANT INSERT, SELECT, UPDATE ON public.accounting_policy_elections TO authenticated;

-- public.accounting_policy_elections.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounting_policy_elections TO service_role;

-- public.amortization_schedules.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.amortization_schedules TO authenticated;

-- public.amortization_schedules.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.amortization_schedules TO service_role;

-- public.approval_settings.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.approval_settings TO authenticated;

-- public.approval_settings.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.approval_settings TO service_role;

-- public.audit_log.authenticated
GRANT INSERT, SELECT ON public.audit_log TO authenticated;

-- public.audit_log.service_role
GRANT INSERT, REFERENCES, SELECT, TRIGGER ON public.audit_log TO service_role;

-- public.branches.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.branches TO authenticated;

-- public.branches.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.branches TO service_role;

-- public.companies.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.companies TO authenticated;

-- public.companies.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.companies TO service_role;

-- public.contract_cancellations.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.contract_cancellations TO authenticated;

-- public.contract_cancellations.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.contract_cancellations TO service_role;

-- public.contract_modifications.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.contract_modifications TO authenticated;

-- public.contract_modifications.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.contract_modifications TO service_role;

-- public.documents.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.documents TO authenticated;

-- public.documents.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.documents TO service_role;

-- public.error_logs.authenticated
GRANT INSERT, SELECT ON public.error_logs TO authenticated;

-- public.error_logs.service_role
GRANT INSERT, REFERENCES, SELECT, TRIGGER ON public.error_logs TO service_role;

-- public.fixed_asset_types.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.fixed_asset_types TO authenticated;

-- public.fixed_asset_types.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.fixed_asset_types TO service_role;

-- public.journal_entries.authenticated
GRANT SELECT ON public.journal_entries TO authenticated;

-- public.journal_entries.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO service_role;

-- public.lease_impairments.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lease_impairments TO authenticated;

-- public.lease_impairments.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lease_impairments TO service_role;

-- public.lease_modifications.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lease_modifications TO authenticated;

-- public.lease_modifications.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lease_modifications TO service_role;

-- public.lease_payment_schedules.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lease_payment_schedules TO authenticated;

-- public.lease_payment_schedules.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lease_payment_schedules TO service_role;

-- public.lease_payments.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lease_payments TO authenticated;

-- public.lease_payments.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lease_payments TO service_role;

-- public.lease_transactions.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lease_transactions TO authenticated;

-- public.lease_transactions.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lease_transactions TO service_role;

-- public.leases.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leases TO authenticated;

-- public.leases.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leases TO service_role;

-- public.leases_missing_amortization.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leases_missing_amortization TO authenticated;

-- public.leases_missing_amortization.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leases_missing_amortization TO service_role;

-- public.lessors.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lessors TO authenticated;

-- public.lessors.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lessors TO service_role;

-- public.month_end_documents.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.month_end_documents TO authenticated;

-- public.month_end_documents.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.month_end_documents TO service_role;

-- public.organizations.authenticated
GRANT SELECT ON public.organizations TO authenticated;

-- public.organizations.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organizations TO service_role;

-- public.stripe_customers.authenticated
GRANT SELECT ON public.stripe_customers TO authenticated;

-- public.stripe_customers.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_customers TO service_role;

-- public.stripe_orders.authenticated
GRANT SELECT ON public.stripe_orders TO authenticated;

-- public.stripe_orders.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_orders TO service_role;

-- public.stripe_processed_events.authenticated
GRANT SELECT ON public.stripe_processed_events TO authenticated;

-- public.stripe_processed_events.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_processed_events TO service_role;

-- public.stripe_subscriptions.authenticated
GRANT SELECT ON public.stripe_subscriptions TO authenticated;

-- public.stripe_subscriptions.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_subscriptions TO service_role;

-- public.stripe_user_orders.authenticated
GRANT SELECT ON public.stripe_user_orders TO authenticated;

-- public.stripe_user_orders.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_user_orders TO service_role;

-- public.stripe_user_subscriptions.authenticated
GRANT SELECT ON public.stripe_user_subscriptions TO authenticated;

-- public.stripe_user_subscriptions.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_user_subscriptions TO service_role;

-- public.subscription_plans.authenticated
GRANT SELECT ON public.subscription_plans TO authenticated;

-- public.subscription_plans.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.subscription_plans TO service_role;

-- public.subscriptions.authenticated
GRANT SELECT ON public.subscriptions TO authenticated;

-- public.subscriptions.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.subscriptions TO service_role;

-- public.transactions.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.transactions TO authenticated;

-- public.transactions.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.transactions TO service_role;

-- public.user_activity_logs.authenticated
GRANT DELETE, INSERT, SELECT, UPDATE ON public.user_activity_logs TO authenticated;

-- public.user_activity_logs.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_activity_logs TO service_role;

-- public.user_profiles.authenticated
GRANT DELETE, INSERT, SELECT ON public.user_profiles TO authenticated;

-- public.user_profiles.service_role
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_profiles TO service_role;


-- ============ Function privileges reset (70) ============

REVOKE ALL ON FUNCTION internal.apply_approval_workflow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.approval_denial_reason(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.approval_required(p_org_id uuid, p_item_type text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.audit_approval_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.can_approve(p_org_id uuid, p_user_id uuid, p_item_type text, p_preparer_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.create_default_approval_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.current_org_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.data_health(p_org uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_lease_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_month_end_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_plan_feature() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_policy_election_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.enforce_role_permissions_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.get_user_emails_for_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.has_data_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.has_permission(perm_key text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_admin(check_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_manage_or_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_platform_admin_for_user(target_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.lease_balance_as_of(p_lease_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.locked_period_status(p_org uuid, p_from date, p_to date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.normalize_account(p text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_has_active_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_has_feature(feature text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_has_feature(feature text, target_org_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_plan_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.org_plan_key(target_org_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.post_month_end_entries() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_audit_log_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_delete_posted_contract_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_month_end_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_period_locked_mutation_je() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_period_locked_mutation_lt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_posted_lease_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_posted_transaction_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_user_id_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_zero_amount_recognition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.reconcile_ledgers(p_org uuid, p_from date, p_to date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.set_organization_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.set_user_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.trial_days() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.validate_approval_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.write_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_approval_permission(p_item_type text, p_item_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_user_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_all_users_with_plans() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_data_health() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lease_posted_through(p_lease_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lease_summary_stats(p_company_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ledger_reconciliation(p_from date, p_to date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pending_approvals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_platform_data_health() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_emails_for_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_platform_admin_for_user(target_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_month_end(p_doc_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_classification_override(p_lease_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_user_profile_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- ============ Function grants (67) ============

-- internal.current_org_id().authenticated
GRANT EXECUTE ON FUNCTION internal.current_org_id() TO authenticated;

-- internal.current_org_id().service_role
GRANT EXECUTE ON FUNCTION internal.current_org_id() TO service_role;

-- internal.get_user_emails_for_admin().authenticated
GRANT EXECUTE ON FUNCTION internal.get_user_emails_for_admin() TO authenticated;

-- internal.has_data_access().authenticated
GRANT EXECUTE ON FUNCTION internal.has_data_access() TO authenticated;

-- internal.has_permission(perm_key text).authenticated
GRANT EXECUTE ON FUNCTION internal.has_permission(perm_key text) TO authenticated;

-- internal.is_admin().authenticated
GRANT EXECUTE ON FUNCTION internal.is_admin() TO authenticated;

-- internal.is_admin(check_user_id uuid).authenticated
GRANT EXECUTE ON FUNCTION internal.is_admin(check_user_id uuid) TO authenticated;

-- internal.is_manage_or_admin().authenticated
GRANT EXECUTE ON FUNCTION internal.is_manage_or_admin() TO authenticated;

-- internal.is_platform_admin().authenticated
GRANT EXECUTE ON FUNCTION internal.is_platform_admin() TO authenticated;

-- internal.lease_balance_as_of(p_lease_id uuid, p_as_of date).authenticated
GRANT EXECUTE ON FUNCTION internal.lease_balance_as_of(p_lease_id uuid, p_as_of date) TO authenticated;

-- internal.org_has_active_subscription().authenticated
GRANT EXECUTE ON FUNCTION internal.org_has_active_subscription() TO authenticated;

-- internal.org_has_feature(feature text).authenticated
GRANT EXECUTE ON FUNCTION internal.org_has_feature(feature text) TO authenticated;

-- internal.org_has_feature(feature text, target_org_id uuid).authenticated
GRANT EXECUTE ON FUNCTION internal.org_has_feature(feature text, target_org_id uuid) TO authenticated;

-- internal.org_plan_key().authenticated
GRANT EXECUTE ON FUNCTION internal.org_plan_key() TO authenticated;

-- internal.org_plan_key(target_org_id uuid).authenticated
GRANT EXECUTE ON FUNCTION internal.org_plan_key(target_org_id uuid) TO authenticated;

-- internal.prevent_month_end_mutation().authenticated
GRANT EXECUTE ON FUNCTION internal.prevent_month_end_mutation() TO authenticated;

-- internal.prevent_period_locked_mutation_je().authenticated
GRANT EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_je() TO authenticated;

-- internal.prevent_period_locked_mutation_lt().authenticated
GRANT EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_lt() TO authenticated;

-- internal.prevent_posted_transaction_mutation().authenticated
GRANT EXECUTE ON FUNCTION internal.prevent_posted_transaction_mutation() TO authenticated;

-- internal.prevent_user_id_change().authenticated
GRANT EXECUTE ON FUNCTION internal.prevent_user_id_change() TO authenticated;

-- internal.reopen_month_end(p_doc_id uuid, p_reason text).authenticated
GRANT EXECUTE ON FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text) TO authenticated;

-- internal.trial_days().authenticated
GRANT EXECUTE ON FUNCTION internal.trial_days() TO authenticated;

-- public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb).authenticated
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb) TO authenticated;

-- public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb).service_role
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text, new_permissions jsonb) TO service_role;

-- public.check_approval_permission(p_item_type text, p_item_id uuid).authenticated
GRANT EXECUTE ON FUNCTION public.check_approval_permission(p_item_type text, p_item_id uuid) TO authenticated;

-- public.check_approval_permission(p_item_type text, p_item_id uuid).service_role
GRANT EXECUTE ON FUNCTION public.check_approval_permission(p_item_type text, p_item_id uuid) TO service_role;

-- public.create_user_profile().service_role
GRANT EXECUTE ON FUNCTION public.create_user_profile() TO service_role;

-- public.get_all_users_with_plans().authenticated
GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO authenticated;

-- public.get_all_users_with_plans().service_role
GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO service_role;

-- public.get_data_health().authenticated
GRANT EXECUTE ON FUNCTION public.get_data_health() TO authenticated;

-- public.get_data_health().service_role
GRANT EXECUTE ON FUNCTION public.get_data_health() TO service_role;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid).authenticated
GRANT EXECUTE ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid) TO authenticated;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid).service_role
GRANT EXECUTE ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid) TO service_role;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text).authenticated
GRANT EXECUTE ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text) TO authenticated;

-- public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text).service_role
GRANT EXECUTE ON FUNCTION public.get_filtered_transactions(p_page integer, p_page_size integer, p_search text, p_type text, p_period text, p_period_start date, p_period_end date, p_branch_id uuid, p_branch_filter text, p_asset_type_id uuid, p_asset_type_filter text, p_company_id uuid, p_lease_classification text) TO service_role;

-- public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[]).authenticated
GRANT EXECUTE ON FUNCTION public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[]) TO authenticated;

-- public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[]).service_role
GRANT EXECUTE ON FUNCTION public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[]) TO service_role;

-- public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean).authenticated
GRANT EXECUTE ON FUNCTION public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean) TO authenticated;

-- public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean).service_role
GRANT EXECUTE ON FUNCTION public.get_lease_portfolio_totals(p_company_id uuid, p_search text, p_lease_type text, p_lessor_type text, p_branch_id uuid, p_branch_unassigned boolean, p_as_of date, p_status text, p_missing_classification boolean) TO service_role;

-- public.get_lease_posted_through(p_lease_id uuid).authenticated
GRANT EXECUTE ON FUNCTION public.get_lease_posted_through(p_lease_id uuid) TO authenticated;

-- public.get_lease_posted_through(p_lease_id uuid).service_role
GRANT EXECUTE ON FUNCTION public.get_lease_posted_through(p_lease_id uuid) TO service_role;

-- public.get_lease_summary_stats(p_company_id uuid, p_as_of date).authenticated
GRANT EXECUTE ON FUNCTION public.get_lease_summary_stats(p_company_id uuid, p_as_of date) TO authenticated;

-- public.get_lease_summary_stats(p_company_id uuid, p_as_of date).service_role
GRANT EXECUTE ON FUNCTION public.get_lease_summary_stats(p_company_id uuid, p_as_of date) TO service_role;

-- public.get_ledger_reconciliation(p_from date, p_to date).authenticated
GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(p_from date, p_to date) TO authenticated;

-- public.get_ledger_reconciliation(p_from date, p_to date).service_role
GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(p_from date, p_to date) TO service_role;

-- public.get_my_plan().authenticated
GRANT EXECUTE ON FUNCTION public.get_my_plan() TO authenticated;

-- public.get_my_plan().service_role
GRANT EXECUTE ON FUNCTION public.get_my_plan() TO service_role;

-- public.get_pending_approvals().authenticated
GRANT EXECUTE ON FUNCTION public.get_pending_approvals() TO authenticated;

-- public.get_pending_approvals().service_role
GRANT EXECUTE ON FUNCTION public.get_pending_approvals() TO service_role;

-- public.get_platform_data_health().authenticated
GRANT EXECUTE ON FUNCTION public.get_platform_data_health() TO authenticated;

-- public.get_platform_data_health().service_role
GRANT EXECUTE ON FUNCTION public.get_platform_data_health() TO service_role;

-- public.get_user_emails_for_admin().authenticated
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;

-- public.get_user_emails_for_admin().service_role
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO service_role;

-- public.is_platform_admin().authenticated
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- public.is_platform_admin().service_role
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO service_role;

-- public.is_platform_admin_for_user(target_user_id uuid).service_role
GRANT EXECUTE ON FUNCTION public.is_platform_admin_for_user(target_user_id uuid) TO service_role;

-- public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb).authenticated
GRANT EXECUTE ON FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb) TO authenticated;

-- public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb).service_role
GRANT EXECUTE ON FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb) TO service_role;

-- public.reopen_month_end(p_doc_id uuid, p_reason text).authenticated
GRANT EXECUTE ON FUNCTION public.reopen_month_end(p_doc_id uuid, p_reason text) TO authenticated;

-- public.reopen_month_end(p_doc_id uuid, p_reason text).service_role
GRANT EXECUTE ON FUNCTION public.reopen_month_end(p_doc_id uuid, p_reason text) TO service_role;

-- public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb).authenticated
GRANT EXECUTE ON FUNCTION public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb) TO authenticated;

-- public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb).service_role
GRANT EXECUTE ON FUNCTION public.save_lease(p_lease jsonb, p_payment_schedule jsonb, p_amortization jsonb, p_recognition jsonb) TO service_role;

-- public.set_classification_override(p_lease_id uuid, p_reason text).authenticated
GRANT EXECUTE ON FUNCTION public.set_classification_override(p_lease_id uuid, p_reason text) TO authenticated;

-- public.set_classification_override(p_lease_id uuid, p_reason text).service_role
GRANT EXECUTE ON FUNCTION public.set_classification_override(p_lease_id uuid, p_reason text) TO service_role;

-- public.sync_user_profile_email().service_role
GRANT EXECUTE ON FUNCTION public.sync_user_profile_email() TO service_role;

-- public.update_updated_at_column().authenticated
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;

-- public.update_updated_at_column().service_role
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

RESET check_function_bodies;

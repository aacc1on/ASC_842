/*
# Approval Workflow Overhaul — Plan-Based Auto-Approval

## Purpose
Rework the policy election approval rules so that:
- Starter/Professional: no approval workflow; saved elections are auto-approved immediately.
- Trial: admin can approve everything in one click (including self-approval) with NO required note.
- Enterprise: unchanged (full workflow; segregation of duties for 2+ users).

## Changes

### 1. internal.enforce_policy_election_rules() — trigger function rewrite

**INSERT path (new auto-approve for starter/pro):**
- After computing version, if the org's plan is 'starter' or 'professional',
  set NEW.status = 'approved', NEW.approved_by = NEW.prepared_by,
  NEW.approved_at = now(), NEW.self_approved = true.
- Remove the "authenticated callers cannot insert approved" block for these plans.
- Write an audit log entry: 'Auto-approved (single-user plan)'.

**Approval note requirement:**
- Trial admin self-approval: remove the "non-empty approval note" requirement.
  The audit entry stays 'Self-approved (trial, admin)'.
- Single-user orgs (enterprise, non-trial): keep the note requirement as before.

**Plan gate block (previously blocked starter/pro from approving):**
- Remove the block that raises 'Approval workflow is not available on your plan'.
  Starter/professional now auto-approve at INSERT, so they never hit the
  UPDATE approval path. If they somehow do (e.g. a draft created before the
  migration), allow it: if the org is starter/pro and an admin sets status to
  approved, treat it as auto-approve (self_approved=true, no note required).

### 2. internal.org_has_feature — no change needed (already correct)

### Security
- RLS is not changed.
- The trigger is SECURITY DEFINER with search_path = '' (already set).

### Important Notes
1. Trial non-admin users still cannot approve — the v_is_admin check remains.
2. Enterprise 2+ user orgs still enforce segregation of duties.
3. Enterprise single-user orgs still self-approve with a required note.
*/

CREATE OR REPLACE FUNCTION internal.enforce_policy_election_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_admin boolean;
  v_is_service_role boolean;
  v_is_authenticated_caller boolean;
  v_company_entity_type text;
  v_next_version int;
  v_prev_id uuid;
  v_org_id uuid;
  v_active_user_count int;
  v_has_multi_user boolean;
  v_can_self_approve boolean;
  v_is_trial_admin boolean;
  v_plan_key text;
  v_auto_approve boolean;
BEGIN
  v_is_admin := (SELECT internal.is_admin());
  v_is_service_role := auth.uid() IS NULL;
  v_is_authenticated_caller := NOT v_is_service_role;

  -- Resolve organization_id and plan early
  IF TG_OP = 'INSERT' THEN
    v_org_id := NEW.organization_id;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.accounting_policy_elections
    WHERE id = NEW.id;
    IF v_org_id IS NULL THEN
      v_org_id := NEW.organization_id;
    END IF;
  END IF;

  v_plan_key := internal.org_plan_key(v_org_id);
  v_auto_approve := v_plan_key IN ('starter', 'professional');

  -- ===== INSERT rules =====
  IF TG_OP = 'INSERT' THEN
    -- For authenticated callers, always force prepared_by/prepared_at/created_by
    IF v_is_authenticated_caller THEN
      NEW.prepared_by := auth.uid();
      NEW.prepared_at := now();
      NEW.created_by := auth.uid();
    ELSE
      IF NEW.prepared_by IS NULL THEN
        NEW.prepared_by := auth.uid();
      END IF;
      IF NEW.prepared_at IS NULL THEN
        NEW.prepared_at := now();
      END IF;
      IF NEW.created_by IS NULL THEN
        NEW.created_by := auth.uid();
      END IF;
    END IF;

    -- Auto-increment policy_version per (company, asset type, policy type)
    SELECT COALESCE(MAX(policy_version), 0) + 1 INTO v_next_version
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
    AND fixed_asset_type_id = NEW.fixed_asset_type_id
    AND policy_type = NEW.policy_type;
    NEW.policy_version := v_next_version;

    -- Initialize self_approved to false on insert
    NEW.self_approved := false;

    -- Auto-approve for starter/professional plans
    IF v_auto_approve THEN
      NEW.status := 'approved';
      NEW.approved_by := NEW.prepared_by;
      NEW.approved_at := now();
      NEW.self_approved := true;

      -- Write audit log entry
      INSERT INTO public.audit_log (
        organization_id, actor_user_id, table_name, record_id,
        action, old_data, new_data, changed_fields
      )
      VALUES (
        v_org_id,
        auth.uid(),
        'accounting_policy_elections',
        NEW.id,
        'Auto-approved (single-user plan)',
        jsonb_build_object('status', 'draft'),
        jsonb_build_object('status', 'approved', 'self_approved', true),
        jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved')
      );

      -- Close previous approved version for this (company, asset, policy)
      SELECT id INTO v_prev_id
      FROM public.accounting_policy_elections
      WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type
      AND status = 'approved'
      AND id != NEW.id
      ORDER BY effective_from DESC
      LIMIT 1;

      IF v_prev_id IS NOT NULL THEN
        UPDATE public.accounting_policy_elections
        SET effective_to = (NEW.effective_from - interval '1 day')::date,
            updated_at = now()
        WHERE id = v_prev_id;
      END IF;

      -- RISK_FREE_RATE check for auto-approved
      IF NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
        SELECT c.entity_type INTO v_company_entity_type
        FROM public.companies c WHERE c.id = NEW.company_id;
        IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
          RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
        END IF;
      END IF;

      RETURN NEW;
    END IF;

    -- Non-auto-approve plans: authenticated callers cannot insert with status 'approved'
    IF v_is_authenticated_caller AND NEW.status = 'approved' THEN
      RAISE EXCEPTION 'New policy elections cannot be created with approved status; submit for approval first';
    END IF;
  END IF;

  -- ===== UPDATE rules =====
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();

    -- Never allow prepared_by, prepared_at, created_by, created_at to change
    IF NEW.prepared_by IS DISTINCT FROM OLD.prepared_by THEN
      RAISE EXCEPTION 'prepared_by cannot be modified';
    END IF;
    IF NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
      RAISE EXCEPTION 'prepared_at cannot be modified';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by cannot be modified';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at cannot be modified';
    END IF;

    -- When status changes to 'approved', force approved_by and approved_at
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
      IF v_is_authenticated_caller THEN
        NEW.approved_by := auth.uid();
        NEW.approved_at := now();
      ELSE
        IF NEW.approved_by IS NULL THEN
          NEW.approved_by := auth.uid();
        END IF;
        IF NEW.approved_at IS NULL THEN
          NEW.approved_at := now();
        END IF;
      END IF;
    END IF;

    -- Never allow approved_by/approved_at to change when already set (except during initial approval above)
    IF OLD.status = 'approved' THEN
      IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
        RAISE EXCEPTION 'approved_by cannot be modified after approval';
      END IF;
      IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
        RAISE EXCEPTION 'approved_at cannot be modified after approval';
      END IF;
    END IF;
  END IF;

  -- Only admins can set status to 'approved' (except auto-approve plans at INSERT)
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND NOT v_is_admin AND NOT v_auto_approve THEN
    RAISE EXCEPTION 'Only administrators can approve policy elections';
  END IF;

  -- Segregation of duties: approved_by must differ from prepared_by
  -- UNLESS: auto-approve plan, trial admin, single-user org
  IF NEW.status = 'approved' AND NEW.approved_by = NEW.prepared_by THEN
    v_is_trial_admin := v_is_admin AND v_plan_key = 'trial';
    v_has_multi_user := internal.org_has_feature('multi_user', v_org_id);

    SELECT count(*) INTO v_active_user_count
    FROM public.user_profiles
    WHERE organization_id = v_org_id;

    v_can_self_approve := v_auto_approve OR v_is_trial_admin OR (NOT v_has_multi_user) OR (v_active_user_count <= 1);

    IF v_can_self_approve THEN
      -- Trial admin self-approval: NO note required
      -- Single-user org (enterprise, non-trial): note IS required
      -- Auto-approve plan: no note required (status set at INSERT)
      IF NOT v_auto_approve AND NOT v_is_trial_admin THEN
        IF NEW.notes IS NULL OR trim(NEW.notes) = '' THEN
          RAISE EXCEPTION 'An approval note is required when self-approving in a single-user organization';
        END IF;
      END IF;
      -- Mark as self-approved
      NEW.self_approved := true;

      -- Write audit log entry
      INSERT INTO public.audit_log (
        organization_id, actor_user_id, table_name, record_id,
        action, old_data, new_data, changed_fields
      )
      VALUES (
        v_org_id,
        auth.uid(),
        'accounting_policy_elections',
        NEW.id,
        CASE
          WHEN v_is_trial_admin THEN 'Self-approved (trial, admin)'
          WHEN v_auto_approve THEN 'Auto-approved (single-user plan)'
          ELSE 'APPROVE'
        END,
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', 'approved', 'self_approved', true),
        jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved')
      );
    ELSE
      RAISE EXCEPTION 'Segregation of duties: the approver must differ from the preparer';
    END IF;
  ELSE
    -- Not a self-approval: ensure self_approved is false
    IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status != 'approved' THEN
      NEW.self_approved := false;
    END IF;
  END IF;

  -- RISK_FREE_RATE with election_value=true cannot be approved for public business entity or null
  IF NEW.status = 'approved' AND NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
    SELECT c.entity_type INTO v_company_entity_type
    FROM public.companies c WHERE c.id = NEW.company_id;
    IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
      RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
    END IF;
  END IF;

  -- Approved rows cannot be edited except to set effective_to or status to inactive
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF NEW.status != OLD.status AND NEW.status != 'inactive' THEN
      RAISE EXCEPTION 'Approved policy elections can only be set to inactive';
    END IF;
    IF NEW.status = OLD.status THEN
      IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
      AND NEW.election_value IS NOT DISTINCT FROM OLD.election_value
      AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
      AND NEW.notes IS NOT DISTINCT FROM OLD.notes
      AND NEW.change_reason IS NOT DISTINCT FROM OLD.change_reason
      AND NEW.supporting_document_id IS NOT DISTINCT FROM OLD.supporting_document_id
      AND NEW.policy_type IS NOT DISTINCT FROM OLD.policy_type
      AND NEW.fixed_asset_type_id IS NOT DISTINCT FROM OLD.fixed_asset_type_id
      AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
      THEN
        NULL;
      ELSIF NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
      AND NEW.election_value IS NOT DISTINCT FROM OLD.election_value
      AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
      AND NEW.notes IS NOT DISTINCT FROM OLD.notes
      AND NEW.change_reason IS NOT DISTINCT FROM OLD.change_reason
      AND NEW.supporting_document_id IS NOT DISTINCT FROM OLD.supporting_document_id
      AND NEW.policy_type IS NOT DISTINCT FROM OLD.policy_type
      AND NEW.fixed_asset_type_id IS NOT DISTINCT FROM OLD.fixed_asset_type_id
      AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
      THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Approved policy elections cannot be edited except to set effective_to or change status to inactive';
      END IF;
    END IF;
  END IF;

  -- When a new version is approved, close the previous approved version
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status != 'approved' THEN
    SELECT id INTO v_prev_id
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
    AND fixed_asset_type_id = NEW.fixed_asset_type_id
    AND policy_type = NEW.policy_type
    AND status = 'approved'
    AND id != NEW.id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_prev_id IS NOT NULL THEN
      UPDATE public.accounting_policy_elections
      SET effective_to = (NEW.effective_from - interval '1 day')::date,
          updated_at = now()
      WHERE id = v_prev_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

/*
# Allow self-approval of policy elections for single-user organizations

## Purpose
On Starter, Professional, and Trial plans (which allow only one user), the
segregation-of-duties rule makes it impossible to approve a policy election
because the same user is both preparer and approver. This migration allows
self-approval when the organization does NOT have the multi_user feature
or has only one active user, with safeguards.

## Changes
1. New column: `accounting_policy_elections.self_approved` (boolean, default false)
   - Set to true when a user self-approves in a single-user org
2. Modified function: `internal.enforce_policy_election_rules()`
   - When status transitions to 'approved' and approved_by = prepared_by:
     - Check if org lacks multi_user feature OR has only 1 active user
     - If so, allow it and set self_approved = true
     - Require a non-empty approval note in the `notes` field
     - Write an audit log entry
     - Otherwise, raise the segregation-of-duties exception as before
3. Audit log entries are written for self-approval events

## Security
- No RLS changes
- The trigger still forces prepared_by/approved_by to auth.uid()
- Enterprise orgs with 2+ users keep the existing segregation rule unchanged
*/

ALTER TABLE public.accounting_policy_elections
  ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false;

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
BEGIN
  v_is_admin := (SELECT internal.is_admin());
  v_is_service_role := auth.uid() IS NULL;
  v_is_authenticated_caller := NOT v_is_service_role;

  -- ===== INSERT rules =====
  IF TG_OP = 'INSERT' THEN
    -- For authenticated callers, always force prepared_by/prepared_at/created_by
    IF v_is_authenticated_caller THEN
      NEW.prepared_by := auth.uid();
      NEW.prepared_at := now();
      NEW.created_by := auth.uid();
    ELSE
      -- service_role: only default when NULL (preserving existing behavior)
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

    -- Authenticated callers cannot insert with status 'approved'
    IF v_is_authenticated_caller AND NEW.status = 'approved' THEN
      RAISE EXCEPTION 'New policy elections cannot be created with approved status; submit for approval first';
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

  -- Only admins can set status to 'approved'
  IF NEW.status = 'approved' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only administrators can approve policy elections';
  END IF;

  -- Segregation of duties: approved_by must differ from prepared_by
  -- UNLESS the org is a single-user org (no multi_user feature or only 1 active user)
  IF NEW.status = 'approved' AND NEW.approved_by = NEW.prepared_by THEN
    -- Check if this org qualifies for self-approval
    SELECT organization_id INTO v_org_id
    FROM public.accounting_policy_elections
    WHERE id = NEW.id;

    IF v_org_id IS NULL AND TG_OP = 'INSERT' THEN
      v_org_id := NEW.organization_id;
    END IF;

    v_has_multi_user := internal.org_has_feature('multi_user');

    SELECT count(*) INTO v_active_user_count
    FROM public.user_profiles
    WHERE organization_id = v_org_id;

    v_can_self_approve := (NOT v_has_multi_user) OR (v_active_user_count <= 1);

    IF v_can_self_approve THEN
      -- Require a non-empty approval note
      IF NEW.notes IS NULL OR trim(NEW.notes) = '' THEN
        RAISE EXCEPTION 'An approval note is required when self-approving in a single-user organization';
      END IF;
      -- Mark as self-approved
      NEW.self_approved := true;

      -- Write audit log entry
      INSERT INTO public.audit_log (
        organization_id,
        actor_user_id,
        table_name,
        record_id,
        action,
        old_data,
        new_data,
        changed_fields
      )
      VALUES (
        v_org_id,
        auth.uid(),
        'accounting_policy_elections',
        NEW.id,
        'APPROVE',
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', 'approved', 'self_approved', true, 'notes', NEW.notes),
        jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved', 'notes')
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
      -- Status unchanged: only effective_to (and updated_at/updated_by) can change
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
        -- effective_to changed, that's allowed
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
        -- Only updated_at/updated_by changed, which is fine
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

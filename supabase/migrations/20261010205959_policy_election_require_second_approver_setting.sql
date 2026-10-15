/*
# Single approval rule for policy elections: organization-level "require second approver" setting

1. Modified Tables
- `organizations`
  - New column `require_second_approver` (boolean, NOT NULL, default false).
    When true, the person who approves a policy election must differ from the preparer
    (segregation of duties). When false (default), an admin may approve their own item.

2. Modified Functions
- `internal.enforce_policy_election_rules()` (trigger on accounting_policy_elections)
  - Replaces the previous plan / trial / single-user / multi-user branches for self-approval
    with ONE rule:
      * Segregation of duties is enforced ONLY when organizations.require_second_approver = true
        (and the org has 2+ users, so an org can never lock itself out).
      * The platform owner (internal.is_platform_admin()) may always approve.
      * Self-approvals record self_approved = true and write an audit_log entry "Self-approved".
  - Self-approval checks only run when status actually transitions to 'approved', so the
    automatic closing of a previous approved version never re-triggers the check.
  - Starter / professional auto-approve on INSERT is unchanged.

3. New Functions
- `public.set_require_second_approver(p_enabled boolean)` (SECURITY DEFINER)
  - Org admins (or the platform owner) toggle the setting for their own organization.
  - Turning it ON requires 2+ users in the organization.
  - Writes an audit_log entry.
  - EXECUTE: authenticated only (revoked from PUBLIC and anon).

4. Security
- organizations still has no UPDATE policy; the setting can only change through the function above.
*/

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS require_second_approver boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION internal.enforce_policy_election_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_admin boolean;
  v_is_owner boolean;
  v_is_service_role boolean;
  v_is_authenticated_caller boolean;
  v_company_entity_type text;
  v_next_version int;
  v_prev_id uuid;
  v_org_id uuid;
  v_plan_key text;
  v_auto_approve boolean;
  v_require_second boolean;
  v_user_count int;
BEGIN
  v_is_admin := (SELECT internal.is_admin());
  v_is_owner := (SELECT internal.is_platform_admin());
  v_is_service_role := auth.uid() IS NULL;
  v_is_authenticated_caller := NOT v_is_service_role;

  IF TG_OP = 'INSERT' THEN
    v_org_id := NEW.organization_id;
  ELSE
    v_org_id := COALESCE(OLD.organization_id, NEW.organization_id);
  END IF;

  v_plan_key := internal.org_plan_key(v_org_id);
  v_auto_approve := v_plan_key IN ('starter', 'professional');

  -- ===== INSERT rules =====
  IF TG_OP = 'INSERT' THEN
    IF v_is_authenticated_caller THEN
      NEW.prepared_by := auth.uid();
      NEW.prepared_at := now();
      NEW.created_by := auth.uid();
    ELSE
      IF NEW.prepared_by IS NULL THEN NEW.prepared_by := auth.uid(); END IF;
      IF NEW.prepared_at IS NULL THEN NEW.prepared_at := now(); END IF;
      IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
    END IF;

    SELECT COALESCE(MAX(policy_version), 0) + 1 INTO v_next_version
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type;
    NEW.policy_version := v_next_version;

    NEW.self_approved := false;

    IF v_auto_approve THEN
      NEW.status := 'approved';
      NEW.approved_by := NEW.prepared_by;
      NEW.approved_at := now();
      NEW.self_approved := true;

      INSERT INTO public.audit_log (
        organization_id, actor_user_id, table_name, record_id,
        action, old_data, new_data, changed_fields
      ) VALUES (
        v_org_id, auth.uid(), 'accounting_policy_elections', NEW.id,
        'Auto-approved (single-user plan)',
        jsonb_build_object('status', 'draft'),
        jsonb_build_object('status', 'approved', 'self_approved', true),
        jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved')
      );

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

      IF NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
        SELECT c.entity_type INTO v_company_entity_type
        FROM public.companies c WHERE c.id = NEW.company_id;
        IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
          RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
        END IF;
      END IF;

      RETURN NEW;
    END IF;

    IF v_is_authenticated_caller AND NEW.status = 'approved' THEN
      RAISE EXCEPTION 'New policy elections cannot be created with approved status; submit for approval first';
    END IF;
  END IF;

  -- ===== UPDATE rules =====
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();

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

    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      IF v_is_authenticated_caller THEN
        NEW.approved_by := auth.uid();
        NEW.approved_at := now();
      ELSE
        IF NEW.approved_by IS NULL THEN NEW.approved_by := auth.uid(); END IF;
        IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
      END IF;
    END IF;

    IF OLD.status = 'approved' THEN
      IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
        RAISE EXCEPTION 'approved_by cannot be modified after approval';
      END IF;
      IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
        RAISE EXCEPTION 'approved_at cannot be modified after approval';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND NOT v_is_admin AND NOT v_is_owner AND NOT v_auto_approve THEN
    RAISE EXCEPTION 'Only administrators can approve policy elections';
  END IF;

  -- ONE approval rule: segregation of duties only when the org requires a second approver.
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.prepared_by THEN
      SELECT COALESCE(o.require_second_approver, false) INTO v_require_second
      FROM public.organizations o WHERE o.id = v_org_id;

      SELECT count(*) INTO v_user_count
      FROM public.user_profiles WHERE organization_id = v_org_id;

      -- The user-count guard keeps a single-user org from locking itself out.
      IF COALESCE(v_require_second, false) AND v_user_count >= 2 AND NOT v_is_owner THEN
        RAISE EXCEPTION 'Segregation of duties: the approver must differ from the preparer';
      END IF;

      NEW.self_approved := true;

      INSERT INTO public.audit_log (
        organization_id, actor_user_id, table_name, record_id,
        action, old_data, new_data, changed_fields
      ) VALUES (
        v_org_id, auth.uid(), 'accounting_policy_elections', NEW.id,
        'Self-approved',
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', 'approved', 'self_approved', true,
                           'approved_by', NEW.approved_by, 'platform_owner', v_is_owner),
        jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved')
      );
    ELSE
      NEW.self_approved := false;
    END IF;
  END IF;

  IF NEW.status = 'approved' AND NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
    SELECT c.entity_type INTO v_company_entity_type
    FROM public.companies c WHERE c.id = NEW.company_id;
    IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
      RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF NEW.status != OLD.status AND NEW.status != 'inactive' THEN
      RAISE EXCEPTION 'Approved policy elections can only be set to inactive';
    END IF;
    IF NEW.status = OLD.status THEN
      IF NEW.election_value IS DISTINCT FROM OLD.election_value
        OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
        OR NEW.supporting_document_id IS DISTINCT FROM OLD.supporting_document_id
        OR NEW.policy_type IS DISTINCT FROM OLD.policy_type
        OR NEW.fixed_asset_type_id IS DISTINCT FROM OLD.fixed_asset_type_id
        OR NEW.company_id IS DISTINCT FROM OLD.company_id
      THEN
        RAISE EXCEPTION 'Approved policy elections cannot be edited except to set effective_to or change status to inactive';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
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

REVOKE ALL ON FUNCTION internal.enforce_policy_election_rules() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.set_require_second_approver(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org_id uuid;
  v_user_count int;
  v_old boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (internal.is_admin() OR internal.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only administrators can change approval settings';
  END IF;

  v_org_id := internal.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for the current user';
  END IF;

  IF p_enabled THEN
    SELECT count(*) INTO v_user_count FROM public.user_profiles WHERE organization_id = v_org_id;
    IF v_user_count < 2 THEN
      RAISE EXCEPTION 'A second approver can only be required when the organization has at least 2 users';
    END IF;
  END IF;

  SELECT require_second_approver INTO v_old FROM public.organizations WHERE id = v_org_id;

  UPDATE public.organizations SET require_second_approver = p_enabled WHERE id = v_org_id;

  INSERT INTO public.audit_log (
    organization_id, actor_user_id, table_name, record_id,
    action, old_data, new_data, changed_fields
  ) VALUES (
    v_org_id, auth.uid(), 'organizations', v_org_id,
    'UPDATE',
    jsonb_build_object('require_second_approver', v_old),
    jsonb_build_object('require_second_approver', p_enabled),
    jsonb_build_array('require_second_approver')
  );

  RETURN p_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_require_second_approver(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_require_second_approver(boolean) TO authenticated;

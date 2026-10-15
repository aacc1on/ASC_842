/*
# Protect owner, organization and status on modification edits

1. Plain-English summary
   Editing a lease modification, cancellation or impairment must never change who owns it,
   which organization it belongs to, or its approval status. Status changes are only allowed
   as their own step (submit, approve, reject), not mixed into a content edit.

2. New function
   - `internal.guard_workflow_fields()` BEFORE UPDATE trigger function.
     Rejects an update made by a signed-in user when:
       a. `user_id` changes (tables that have it),
       b. `organization_id` changes,
       c. `status` changes in the same update as any content column.
     Status-only updates (optionally with rejection_comment / approval columns) still work,
     so approve, reject and resubmit keep working. Posting updates do not touch status and
     are unaffected. Server-side jobs (no signed-in user) are not restricted.

3. Triggers
   - `a01_guard_workflow_fields` on contract_modifications, contract_cancellations,
     lease_impairments. Named so it runs after organization defaulting and before the
     approval workflow trigger.

4. Security
   - SECURITY DEFINER with empty search_path; EXECUTE revoked from public, anon, authenticated.
*/

CREATE OR REPLACE FUNCTION internal.guard_workflow_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_workflow text[] := ARRAY['status','rejection_comment','approved_by','approved_at','self_approved','prepared_by','updated_at'];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_new ? 'user_id' AND (v_new->'user_id') IS DISTINCT FROM (v_old->'user_id') THEN
    RAISE EXCEPTION 'The owner of this record cannot be changed';
  END IF;
  IF (v_new->'organization_id') IS DISTINCT FROM (v_old->'organization_id') THEN
    RAISE EXCEPTION 'The organization of this record cannot be changed';
  END IF;
  IF (v_new->'status') IS DISTINCT FROM (v_old->'status')
     AND (v_new - v_workflow) IS DISTINCT FROM (v_old - v_workflow) THEN
    RAISE EXCEPTION 'Status cannot be changed while editing. Save your changes, then submit, approve or reject separately';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION internal.guard_workflow_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a01_guard_workflow_fields ON public.contract_modifications;
CREATE TRIGGER a01_guard_workflow_fields BEFORE UPDATE ON public.contract_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.guard_workflow_fields();

DROP TRIGGER IF EXISTS a01_guard_workflow_fields ON public.contract_cancellations;
CREATE TRIGGER a01_guard_workflow_fields BEFORE UPDATE ON public.contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION internal.guard_workflow_fields();

DROP TRIGGER IF EXISTS a01_guard_workflow_fields ON public.lease_impairments;
CREATE TRIGGER a01_guard_workflow_fields BEFORE UPDATE ON public.lease_impairments
  FOR EACH ROW EXECUTE FUNCTION internal.guard_workflow_fields();

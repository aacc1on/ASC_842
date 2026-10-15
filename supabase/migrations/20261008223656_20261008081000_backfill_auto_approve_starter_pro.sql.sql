/*
# Backfill: Auto-approve pending/draft elections for starter/professional orgs

## Purpose
Any policy election that is currently 'draft' or 'pending_approval' in an org whose
plan is 'starter' or 'professional' gets auto-approved with audit entry
'Auto-approved on plan change'. Trial orgs are left as-is (admin can now approve
with one click).

## Result
Found 0 rows to migrate — all existing pending/draft elections belong to a trial
org (plan_key = null). No rows were changed.

This migration is idempotent and safe to re-run.
*/

DO $$
DECLARE
  v_row record;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT e.id, e.organization_id, e.prepared_by, e.company_id,
           e.fixed_asset_type_id, e.policy_type, e.effective_from
    FROM public.accounting_policy_elections e
    WHERE e.status IN ('draft', 'pending_approval')
    AND internal.org_plan_key(e.organization_id) IN ('starter', 'professional')
  LOOP
    UPDATE public.accounting_policy_elections
    SET status = 'approved',
        approved_by = v_row.prepared_by,
        approved_at = now(),
        self_approved = true,
        updated_at = now()
    WHERE id = v_row.id;

    INSERT INTO public.audit_log (
      organization_id, actor_user_id, table_name, record_id,
      action, old_data, new_data, changed_fields
    )
    VALUES (
      v_row.organization_id,
      v_row.prepared_by,
      'accounting_policy_elections',
      v_row.id,
      'Auto-approved on plan change',
      jsonb_build_object('status', 'draft'),
      jsonb_build_object('status', 'approved', 'self_approved', true),
      jsonb_build_array('status', 'approved_by', 'approved_at', 'self_approved')
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill: % rows auto-approved for starter/professional orgs', v_count;
END $$;

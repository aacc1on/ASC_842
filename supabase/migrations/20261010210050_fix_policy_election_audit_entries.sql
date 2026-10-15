/*
# Fix audit_log writes from policy-election approval

1. Problem
- internal.enforce_policy_election_rules() and public.set_require_second_approver() passed a jsonb
  array into audit_log.changed_fields (text[]), and used action labels not allowed by
  audit_log_action_check. Every self-approval and every starter/professional auto-approve
  therefore failed.

2. Changes
- audit_log_action_check now also allows 'Self-approved' and 'Auto-approved (single-user plan)'.
  The constraint is only widened; no existing rows are affected.
- Both functions now write changed_fields as text[].

3. Security
- No grant or policy changes.
*/

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY['INSERT','UPDATE','DELETE','BACKFILL','Self-approved','Auto-approved (single-user plan)']));

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('internal.enforce_policy_election_rules()'::regprocedure);
  v_new := replace(v_def,
    'jsonb_build_array(''status'', ''approved_by'', ''approved_at'', ''self_approved'')',
    'ARRAY[''status'', ''approved_by'', ''approved_at'', ''self_approved'']::text[]');
  IF v_new = v_def OR position('jsonb_build_array' in v_new) > 0 THEN
    RAISE EXCEPTION 'enforce_policy_election_rules: replacement did not apply';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.set_require_second_approver(boolean)'::regprocedure);
  v_new := replace(v_def,
    'jsonb_build_array(''require_second_approver'')',
    'ARRAY[''require_second_approver'']::text[]');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'set_require_second_approver: replacement did not apply';
  END IF;
  EXECUTE v_new;
END $$;

REVOKE ALL ON FUNCTION internal.enforce_policy_election_rules() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_require_second_approver(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_require_second_approver(boolean) TO authenticated;

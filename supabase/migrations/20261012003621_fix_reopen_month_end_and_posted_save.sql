/*
# Fix month-end reopen + posted-lease descriptive edits

1. Reopen month-end was failing
- `internal.reopen_month_end` used `SET LOCAL _skip_period_check`, which Postgres rejects
  ("unrecognized configuration parameter"), so reopening always failed.
- The flag is renamed to `app.skip_period_check` everywhere it is set or read.
- New `public.reopen_month_end(p_doc_id, p_reason)` wrapper (SECURITY INVOKER) so the
  reopen-month-end edge function's RPC call resolves. All checks stay in the internal function
  (admin only, reason required, latest posted month only).

2. Posted-lease descriptive edits
- When save_lease edits a lease that has posted periods, the finance-inputs trigger now only
  re-checks fair value / useful life if those inputs actually change, so renaming a posted
  lease that is missing classification data is no longer blocked.

Security: no policy changes. The wrapper is granted to authenticated only.
*/

DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','internal') AND p.prokind = 'f' AND p.prosrc LIKE '%\_skip\_period\_check%'
      AND p.prosrc NOT LIKE '%app.skip_period_check%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'SET LOCAL _skip_period_check = ''1'';', 'PERFORM set_config(''app.skip_period_check'', ''1'', true);');
    v_def := replace(v_def, 'current_setting(''_skip_period_check''', 'current_setting(''app.skip_period_check''');
    EXECUTE v_def;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_month_end(p_doc_id uuid, p_reason text)
RETURNS public.month_end_documents
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT internal.reopen_month_end(p_doc_id, p_reason);
$$;
REVOKE ALL ON FUNCTION public.reopen_month_end(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_month_end(uuid, text) TO authenticated;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.save_lease(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  IF v_def NOT LIKE '%''app.saving_lease'', ''posted''%' THEN
    v_def := replace(v_def,
      'p_lease := (to_jsonb(v_old) - ''id'') || p_lease;',
      'p_lease := (to_jsonb(v_old) - ''id'') || p_lease;
      PERFORM set_config(''app.saving_lease'', ''posted'', true);');
    EXECUTE v_def;
  END IF;
END $$;

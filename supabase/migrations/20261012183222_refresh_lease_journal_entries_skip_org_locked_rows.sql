/*
# Journal refresh: never touch rows in any locked organization period

## Plain-English summary
The journal refresh function already kept every entry up to the end of the lease's
posted-through month. Accounting locks are recorded per organization, and the safety
trigger on journal entries checks the organization's locked periods. This update makes
the refresh use the same rule, so it never even tries to delete an entry that sits in
any locked or closed period. That covers the rare case of a locked month falling outside
the lease's posted-through range. Payload entries landing in such a period are rejected
once locked history exists.

## Changes
1. `public.refresh_lease_journal_entries(uuid, jsonb)` is replaced:
   - Rows kept = rows dated on or before the posted-through month end, plus rows in any
     locked or closed organization period.
   - It deletes only the remaining rows.
   - After locked history exists, payload entries dated in the kept range or in a locked
     period are rejected with a clear message.
   - The return shape is unchanged: kept_locked, deleted, inserted, posted_through.

## Security
- Still SECURITY DEFINER with an empty search_path.
- Same sign-in, role, permission, subscription and organization checks.
- EXECUTE is granted only to authenticated.
*/

CREATE OR REPLACE FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
$function$;

REVOKE ALL ON FUNCTION public.refresh_lease_journal_entries(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_lease_journal_entries(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_lease_journal_entries(uuid, jsonb) TO authenticated;

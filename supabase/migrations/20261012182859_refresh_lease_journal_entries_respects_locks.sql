/*
# Journal refresh that respects posted months, plus lock gaps

## Plain-English summary
Refreshing a lease's journal used to delete every entry and re-insert the full life
from the browser. Since posted months are locked, that failed for every posted lease.
Refreshing now happens in one database step that keeps posted-month entries untouched
and only replaces entries after the last posted month.

## 1. New function `public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb)`
- SECURITY DEFINER, empty search_path, granted to `authenticated` only.
- Same checks as save_lease: signed in, manage/admin role, `create_edit_leases`
  permission, active subscription (or platform admin), lease in caller's organization.
- Locked boundary = end of the month returned by `get_lease_posted_through`.
- Deletes only this lease's entries dated after the boundary.
- Inserts only supplied entries dated after the boundary. A supplied entry dated in a
  locked month is rejected, EXCEPT when the lease has no entries at all in the locked
  range yet (first-time fill for a back-dated lease), where nothing posted is changed.
- Duplicate entries are ignored (ON CONFLICT DO NOTHING), so it is idempotent.
- Returns `{kept_locked, deleted, inserted, posted_through}`.

## 2. Unique key on journal_entries
`(lease_id, entry_date, entry_type, account_name, amortization_id, description)`
NULLS NOT DISTINCT. `description` is included because a finance payment
legitimately books two "Lease Liability" debits (principal and interest) with the same
date/type/account. Checked before applying: 0 existing duplicates on this key.

## 3. Direct journal writes revoked
INSERT/UPDATE/DELETE on journal_entries revoked from anon/authenticated; the function
above is now the only write path. Reads are unchanged.

## 4. Lease delete guard
New BEFORE DELETE trigger on leases: a lease with posted months cannot be deleted
("This lease has posted periods..."). Previously the delete failed with a confusing
cascade error from the child-table locks.

## 5. Posted month-end transactions
`internal.prevent_posted_transaction_mutation` now also blocks changes to rows whose
month-end document is 'posted' (previously only 'finalized'/'closed'). Deleting the
latest month-end document still works: its transactions are cascaded after the
document row is gone, so the check finds no live document.

## Notes
1. No posted rows are changed by this migration.
2. Service-role/maintenance paths (auth.uid() IS NULL) are unaffected, as before.
*/

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_natural_key
  ON public.journal_entries (lease_id, entry_date, entry_type, account_name, amortization_id, description)
  NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.refresh_lease_journal_entries(p_lease_id uuid, p_entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease public.leases%ROWTYPE;
  v_org uuid;
  v_posted_through date;
  v_lock_end date;
  v_has_locked_rows boolean := false;
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
    SELECT count(*) INTO v_kept FROM public.journal_entries
      WHERE lease_id = p_lease_id AND entry_date <= v_lock_end;
    v_has_locked_rows := v_kept > 0;

    IF v_has_locked_rows THEN
      SELECT min((e->>'entry_date')::date) INTO v_bad_date
      FROM jsonb_array_elements(p_entries) e
      WHERE (e->>'entry_date')::date <= v_lock_end;
      IF v_bad_date IS NOT NULL THEN
        RAISE EXCEPTION 'Journal entries for % are in a posted period and cannot be replaced (posted through %).',
          to_char(v_bad_date, 'FMMonth YYYY'), to_char(v_posted_through, 'FMMonth YYYY');
      END IF;
    END IF;
  END IF;

  DELETE FROM public.journal_entries
  WHERE lease_id = p_lease_id
    AND (v_lock_end IS NULL OR entry_date > v_lock_end);
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
    'kept_locked', CASE WHEN v_has_locked_rows THEN v_kept ELSE 0 END,
    'deleted', v_deleted,
    'inserted', v_inserted,
    'posted_through', v_posted_through
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_lease_journal_entries(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_lease_journal_entries(uuid, jsonb) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.journal_entries FROM anon, authenticated;

CREATE OR REPLACE FUNCTION internal.prevent_posted_lease_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION internal.prevent_posted_lease_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_posted_lease_delete ON public.leases;
CREATE TRIGGER prevent_posted_lease_delete
  BEFORE DELETE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_lease_delete();

CREATE OR REPLACE FUNCTION internal.prevent_posted_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

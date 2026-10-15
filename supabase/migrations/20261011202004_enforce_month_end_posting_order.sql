/*
# Enforce month-end posting order and latest-only reopen

1. Posting rule (new trigger `ab_enforce_month_end_order` on month_end_documents)
   - A month can be set to `posted` only after its period end date has passed.
   - Every earlier month since the earliest lease commencement in the organization must
     already be posted (status posted, finalized or closed).
   - Applies only when a document becomes `posted`; existing documents are not touched.
2. Reopen rule (`internal.reopen_month_end`)
   - Only the latest posted month in the organization can be reopened.
3. Notes
   - The `_skip_period_check` flag set by reopen still bypasses the posting checks, because a
     reopen returns an already-posted month to `posted`.
   - No data is changed by this migration.
*/

CREATE OR REPLACE FUNCTION internal.enforce_month_end_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_start date;
  v_period_end date;
  v_earliest date;
  v_cursor date;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'finalized', 'closed') THEN RETURN NEW; END IF;
  IF coalesce(current_setting('_skip_period_check', true), '') = '1' THEN RETURN NEW; END IF;

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
$$;

REVOKE ALL ON FUNCTION internal.enforce_month_end_order() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ab_enforce_month_end_order ON public.month_end_documents;
CREATE TRIGGER ab_enforce_month_end_order
  BEFORE INSERT OR UPDATE OF status ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_month_end_order();

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

  SELECT * INTO v_doc FROM public.month_end_documents
  WHERE id = p_doc_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Month-end document not found';
  END IF;

  IF v_doc.status NOT IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Only finalized or closed documents can be reopened';
  END IF;

  SELECT max(left(d.period, 7)) INTO v_latest
  FROM public.month_end_documents d
  WHERE d.organization_id = v_org_id
    AND d.status IN ('posted', 'finalized', 'closed');

  IF left(v_doc.period, 7) < v_latest THEN
    RAISE EXCEPTION 'Only the latest posted month (%) can be reopened. Reopen later months first.', v_latest;
  END IF;

  -- Lets the mutation and posting-order triggers accept this status change.
  SET LOCAL _skip_period_check = '1';

  UPDATE public.month_end_documents
  SET status = 'posted'
  WHERE id = p_doc_id
  RETURNING * INTO v_doc;

  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (
    v_org_id, auth.uid(), 'month_end_documents', p_doc_id::text, 'REOPEN',
    jsonb_build_object('old_status', 'finalized', 'reason', p_reason),
    jsonb_build_object('new_status', 'posted'),
    ARRAY['status']
  );

  RETURN v_doc;
END;
$function$;
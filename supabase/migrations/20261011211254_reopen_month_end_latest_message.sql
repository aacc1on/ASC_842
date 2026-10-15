/*
# Reopen month-end: unified "latest posted month" message

1. Changes
- `internal.reopen_month_end` keeps the same rules; only the refusal message is aligned with deletion:
  "Remove later months first (latest posted: <Month YYYY>)".
2. Notes
- No data changes.
*/
CREATE OR REPLACE FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text)
RETURNS month_end_documents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
SELECT * INTO v_doc FROM public.month_end_documents WHERE id = p_doc_id AND organization_id = v_org_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Month-end document not found';
END IF;
IF v_doc.status NOT IN ('finalized', 'closed') THEN
RAISE EXCEPTION 'Only finalized or closed documents can be reopened';
END IF;
SELECT max(left(d.period, 7)) INTO v_latest FROM public.month_end_documents d
WHERE d.organization_id = v_org_id AND d.status IN ('posted', 'finalized', 'closed');
IF left(v_doc.period, 7) < v_latest THEN
RAISE EXCEPTION 'Remove later months first (latest posted: %)', to_char(to_date(v_latest || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
END IF;
SET LOCAL _skip_period_check = '1';
UPDATE public.month_end_documents SET status = 'posted' WHERE id = p_doc_id RETURNING * INTO v_doc;
INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
VALUES (v_org_id, auth.uid(), 'month_end_documents', p_doc_id::text, 'REOPEN',
jsonb_build_object('old_status', 'finalized', 'reason', p_reason), jsonb_build_object('new_status', 'posted'), ARRAY['status']);
RETURN v_doc;
END;
$function$;
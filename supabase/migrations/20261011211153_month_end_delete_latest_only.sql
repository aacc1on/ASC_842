/*
# Month-end: only the latest posted month can be deleted

1. Changes
- `internal.prevent_month_end_mutation()` (BEFORE DELETE trigger on month_end_documents) now refuses to delete
  a posted/finalized/closed month when a later month in the same organization is also posted.
  Message: "Remove later months first (latest posted: <Month YYYY>)".
2. Notes
- Existing rules kept: finalized/closed documents still cannot be modified; system jobs (no signed-in user)
  and the `_skip_period_check` maintenance flag are unaffected.
- No data is changed.
*/
CREATE OR REPLACE FUNCTION internal.prevent_month_end_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_skip text;
  v_latest text;
BEGIN
  v_skip := current_setting('_skip_period_check', true);
  IF v_skip = '1' OR auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a finalized or closed month-end document. Use the reopen function.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'finalized', 'closed') THEN
      SELECT max(period) INTO v_latest FROM month_end_documents
       WHERE organization_id = OLD.organization_id AND status IN ('posted', 'finalized', 'closed');
      IF v_latest IS NOT NULL AND OLD.period < v_latest THEN
        RAISE EXCEPTION 'Remove later months first (latest posted: %)',
          to_char(to_date(v_latest || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
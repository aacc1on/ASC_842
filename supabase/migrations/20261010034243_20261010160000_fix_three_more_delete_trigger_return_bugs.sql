/*
# Fix three BEFORE DELETE triggers that return NEW (NULL) on DELETE

## Root cause
Three trigger functions are used for BEFORE DELETE triggers but always return NEW.
For a DELETE operation, NEW is NULL. Returning NULL from a BEFORE DELETE trigger
silently cancels the deletion — the row stays but no error is raised. This is the
same bug that was fixed on `prevent_period_locked_mutation_lt` in migration
20261010150000.

## Affected triggers
1. `internal.prevent_period_locked_mutation_je()` — used by
   `prevent_period_locked_je_delete` on `journal_entries`.
   Every journal entry delete was silently cancelled.

2. `internal.prevent_month_end_mutation()` — used by
   `prevent_month_end_delete` on `month_end_documents`.
   Every month-end document delete was silently cancelled.

3. `internal.prevent_posted_transaction_mutation()` — used by
   `prevent_posted_transaction_delete` on `transactions`.
   Every transaction delete was silently cancelled.

## Fix
Each function now returns OLD when TG_OP = 'DELETE' and NEW for INSERT/UPDATE.
The early-return paths (service role, skip flag) also return OLD for DELETE.

## Not affected (false positives in audit)
- `internal.prevent_audit_log_mutation()` — always raises an exception, never
  returns, so the return value is irrelevant. No fix needed.
- `storage.protect_delete()` — statement-level trigger (FOR EACH STATEMENT).
  Return value is ignored for statement-level triggers. No fix needed.

## Security
- No RLS changes. All trigger guard logic (locked periods, finalized documents)
  is preserved — only the return value on the happy path is corrected.
*/

-- ============================================================
-- 1. Fix prevent_period_locked_mutation_je (journal_entries)
-- ============================================================
CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_je()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_status text;
  v_entry_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_entry_date := COALESCE(NEW.entry_date, OLD.entry_date);

  SELECT ap.status INTO v_period_status
  FROM public.accounting_periods ap
  WHERE ap.organization_id = internal.current_org_id()
    AND v_entry_date >= ap.period_start
    AND v_entry_date <= ap.period_end
    AND ap.status IN ('locked', 'closed')
  LIMIT 1;

  IF v_period_status IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify journal entries in a % accounting period', v_period_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Fix prevent_month_end_mutation (month_end_documents)
-- ============================================================
CREATE OR REPLACE FUNCTION internal.prevent_month_end_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_skip text;
BEGIN
  v_skip := current_setting('_skip_period_check', true);
  IF v_skip = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a finalized or closed month-end document. Use the reopen function.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Fix prevent_posted_transaction_mutation (transactions)
-- ============================================================
CREATE OR REPLACE FUNCTION internal.prevent_posted_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT med.status INTO v_doc_status
  FROM public.month_end_documents med
  WHERE med.id = COALESCE(NEW.month_end_document_id, OLD.month_end_document_id);

  IF v_doc_status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a transaction belonging to a finalized month-end document';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Verify: re-run the audit to confirm no BEFORE DELETE triggers
-- still return NEW without RETURN OLD
-- ============================================================
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  (pg_get_functiondef(p.oid) LIKE '%RETURN OLD%') AS now_has_return_old
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE NOT t.tgisinternal
  AND (t.tgtype & 2) = 2  -- BEFORE
  AND (t.tgtype & 8) = 8  -- fires on DELETE
  AND c.relname NOT IN ('audit_log')  -- audit_log always raises, no return needed
  AND c.relname NOT IN ('buckets', 'objects')  -- statement-level, return ignored
ORDER BY c.relname;

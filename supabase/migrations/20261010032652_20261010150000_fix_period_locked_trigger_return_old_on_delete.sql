/*
# Fix prevent_period_locked_mutation_lt to return OLD on DELETE

## Root cause
The `internal.prevent_period_locked_mutation_lt()` trigger function is used for
both BEFORE UPDATE and BEFORE DELETE on lease_transactions. It always returns
NEW, but for a DELETE operation NEW is NULL. Returning NULL from a BEFORE DELETE
trigger silently cancels the deletion — the row stays but no error is raised.

This is why the $0.00 initial_recognition row for Vehicle 14 could not be
deleted: the trigger returned NULL (NEW), so PostgreSQL skipped the DELETE.

## Fix
Return OLD for DELETE operations (TG_OP = 'DELETE') and NEW for INSERT/UPDATE.
This is the standard PL/pgSQL pattern for multi-operation triggers.

## Security
- No RLS changes. The trigger still raises an exception for locked/closed periods.
- The early-return for auth.uid() IS NULL (service role) is preserved.
*/

CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_lt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_status text;
  v_tx_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    -- Service role bypasses period locking checks
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_tx_date := COALESCE(NEW.transaction_date, OLD.transaction_date);

  SELECT ap.status INTO v_period_status
  FROM public.accounting_periods ap
  WHERE ap.organization_id = internal.current_org_id()
    AND v_tx_date >= ap.period_start
    AND v_tx_date <= ap.period_end
    AND ap.status IN ('locked', 'closed')
  LIMIT 1;

  IF v_period_status IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify lease transactions in a % accounting period', v_period_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

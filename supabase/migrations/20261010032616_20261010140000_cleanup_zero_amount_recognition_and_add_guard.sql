/*
# Cleanup $0.00 initial recognition entries + add database guard

## Purpose
System-generated initial_recognition entries with amount = 0 have no accounting
meaning. They were created by the backfill migration (20261010020056) which used
COALESCE(l.lease_liability, 0), producing $0.00 rows for leases that had no
liability computed at backfill time. This migration:

1. Deletes existing $0.00 initial_recognition rows whose accounting period is OPEN
   (no accounting_periods record with status 'locked' or 'closed').
2. Writes an audit_log entry for the cleanup.
3. Adds a BEFORE INSERT/UPDATE trigger that rejects initial_recognition rows
   where amount rounds to 0, so the database enforces the guard regardless of
   which client writes the row.

## Tables affected
- lease_transactions (DELETE + new trigger)
- audit_log (INSERT)

## Security
- No RLS policy changes.
- The trigger raises an exception with a user-safe message.
- The cleanup uses a WHERE clause that only touches amount = 0.00
  initial_recognition rows in open periods.
*/

-- ============================================================
-- Step 1: Delete $0.00 initial_recognition rows in open periods
-- ============================================================
CREATE TEMP TABLE _zero_amount_cleanup AS
SELECT
  lt.id,
  lt.lease_id,
  lt.transaction_date,
  lt.amount,
  lt.description,
  lt.organization_id,
  COALESCE(ap.status, 'open') AS period_status
FROM lease_transactions lt
LEFT JOIN accounting_periods ap
  ON ap.period = to_char(lt.transaction_date::date, 'YYYY-MM')
WHERE lt.transaction_type = 'initial_recognition'
  AND ROUND(lt.amount::numeric, 2) = 0.00;

-- Write audit entries for each deleted row (organization_id is NOT NULL)
INSERT INTO audit_log (organization_id, table_name, record_id, action, old_data)
SELECT
  COALESCE(zc.organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  'lease_transactions',
  zc.id::text,
  'DELETE',
  to_jsonb(zc)
FROM _zero_amount_cleanup zc;

-- Delete only rows in open periods (period_status not in locked/closed)
DELETE FROM lease_transactions
WHERE id IN (
  SELECT id FROM _zero_amount_cleanup
  WHERE period_status NOT IN ('locked', 'closed')
);

-- Report how many were deleted
SELECT
  COUNT(*) AS total_zero_amount_rows,
  COUNT(*) FILTER (WHERE period_status NOT IN ('locked', 'closed')) AS deleted_rows,
  COUNT(*) FILTER (WHERE period_status IN ('locked', 'closed')) AS skipped_locked_rows
FROM _zero_amount_cleanup;

-- ============================================================
-- Step 2: Add trigger to prevent future $0.00 initial_recognition inserts
-- ============================================================
CREATE OR REPLACE FUNCTION internal.prevent_zero_amount_recognition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type = 'initial_recognition' AND ROUND(NEW.amount::numeric, 2) = 0.00 THEN
    RAISE EXCEPTION 'Initial recognition entries must have a non-zero amount. The lease liability rounds to zero — no recognition entry is created.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_zero_amount_recognition_lt ON lease_transactions;
CREATE TRIGGER prevent_zero_amount_recognition_lt
  BEFORE INSERT OR UPDATE ON lease_transactions
  FOR EACH ROW
  EXECUTE FUNCTION internal.prevent_zero_amount_recognition();

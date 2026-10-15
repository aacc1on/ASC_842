/*
# Fix last-period ending liability residuals (A3)

## Problem
8 leases have small positive ending_liability residuals (0.01–0.08) in
their final amortization schedule period due to rounding accumulation.
The production calculator has been fixed to true-up the final period's
ending liability to exactly 0.00 by absorbing the residual into
principal_reduction.

## Fix
This migration updates the last-period rows for the 8 affected leases:
- Sets ending_liability = 0.00
- Adds the residual to principal_reduction

No posted month-end documents exist, so no posted periods are touched.

## Affected leases
- Building 1 (residual 0.03)
- Building 3 (residual 0.08)
- Vehicle 2 (residual 0.01)
- Vehicle 3 (residual 0.03)
- Vehicle 5 (residual 0.03)
- Vehicle 7 (residual 0.02)
- Vehicle 16 (residual 0.01)
- Warehouse (residual 0.04)
*/

UPDATE amortization_schedules a
SET
  ending_liability = 0,
  principal_reduction = principal_reduction + (
    SELECT old_ending.ending_liability
    FROM (
      SELECT a2.lease_id, a2.ending_liability
      FROM amortization_schedules a2
      WHERE a2.period_number = (
        SELECT max(b.period_number) FROM amortization_schedules b WHERE b.lease_id = a2.lease_id
      )
      AND a2.ending_liability > 0
    ) AS old_ending
    WHERE old_ending.lease_id = a.lease_id
  )
WHERE a.period_number = (
  SELECT max(b.period_number) FROM amortization_schedules b WHERE b.lease_id = a.lease_id
)
AND a.ending_liability > 0;

-- Verify: all last periods should now have ending_liability = 0
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM amortization_schedules a
  WHERE a.ending_liability > 0
  AND a.period_number = (
    SELECT max(b.period_number) FROM amortization_schedules b WHERE b.lease_id = a.lease_id
  );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Verification failed: % last-period rows still have ending_liability > 0', v_count;
  END IF;
  RAISE NOTICE 'Verification passed: all last-period ending liabilities are 0';
END $$;

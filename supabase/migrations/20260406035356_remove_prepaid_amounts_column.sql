/*
  # Remove prepaid_amounts column from leases table

  ## Summary
  Removes the prepaid_amounts field from the leases table as prepaid lease
  amortization coding and formulas are no longer used in the application.

  ## Changes
  - Drops the `prepaid_amounts` column from the `leases` table

  ## Notes
  - Existing data in the column will be permanently removed
  - All application code referencing prepaid_amounts has been updated accordingly
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'prepaid_amounts'
  ) THEN
    ALTER TABLE leases DROP COLUMN prepaid_amounts;
  END IF;
END $$;

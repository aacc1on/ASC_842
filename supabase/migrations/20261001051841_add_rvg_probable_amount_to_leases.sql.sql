/*
# Add rvg_probable_amount to leases

## Purpose
ASC 842-10-30-5(f): the lease liability should include only the amount of the
residual value guarantee that is **probable** of being owed, not the full
guarantee maximum. This migration adds a column to store that probable amount
separately from the existing `residual_value_guarantee` (which remains the
maximum/contractual amount).

## Changes
1. New column: `leases.rvg_probable_amount` (numeric, NOT NULL, DEFAULT 0, CHECK >= 0)
2. Backfill: existing rows get `rvg_probable_amount = residual_value_guarantee`
   so their measured liability does not change until the user edits the lease.

## Security
No RLS or policy changes — the column inherits the existing lease policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'rvg_probable_amount'
  ) THEN
    ALTER TABLE leases ADD COLUMN rvg_probable_amount numeric NOT NULL DEFAULT 0 CHECK (rvg_probable_amount >= 0);
  END IF;
END $$;

-- Backfill: copy residual_value_guarantee into rvg_probable_amount for existing rows
-- so their liability measurements remain identical until the user re-saves.
UPDATE leases
SET rvg_probable_amount = COALESCE(residual_value_guarantee, 0)
WHERE rvg_probable_amount = 0 AND COALESCE(residual_value_guarantee, 0) > 0;

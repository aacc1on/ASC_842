/*
# Add accounting_posted to contract_modifications

## Purpose
ASC 842-10-25-8 to 25-18, 842-10-35-4: When a lease modification is approved,
the remeasurement must be applied to the lease, its amortization schedule, and
the journal entries. The `accounting_posted` flag ensures a modification can
never be applied twice — once true, re-approval is a no-op.

## Changes
1. New column: `contract_modifications.accounting_posted` (boolean, NOT NULL, DEFAULT false)
2. Backfill: existing approved rows get `accounting_posted = false` (they were
   never actually applied under the old code, so they should remain eligible).

## Security
No RLS or policy changes — the column inherits existing policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_modifications' AND column_name = 'accounting_posted'
  ) THEN
    ALTER TABLE contract_modifications ADD COLUMN accounting_posted boolean NOT NULL DEFAULT false;
  END IF;
END $$;

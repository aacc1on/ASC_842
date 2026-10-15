/*
# Add Short-Term Lease Recognition Exemption (ASC 842)

## Summary
Adds support for the ASC 842-20-25-2 short-term lease recognition exemption.
Existing recognized leases are backfilled to 'recognized' and are completely
unaffected — their ROU, liability, amortization, and journal entries stay the same.

## New Columns on `leases`
1. `accounting_treatment` text NOT NULL DEFAULT 'recognized'
   CHECK in ('recognized','short_term_exemption')
   — Controls whether the lease is on-balance-sheet ('recognized') or exempt
     ('short_term_exemption'). Backfilled to 'recognized' for all existing rows.
2. `short_term_policy_election_id` uuid NULL
   REFERENCES accounting_policy_elections(id) ON DELETE SET NULL
   — The policy election record that authorized the exemption, if applied.

## New Column on `amortization_schedules`
3. `short_term_lease_cost` numeric NOT NULL DEFAULT 0
   — Straight-line lease cost for exempt leases. 0 for recognized leases.

## Backfill
- All existing leases set to accounting_treatment = 'recognized'.
- All existing amortization schedule rows set to short_term_lease_cost = 0.

## Security
- No new tables. No RLS policy changes. Existing tenant isolation, subscription,
  and audit triggers remain in effect. The new columns inherit existing policies.
*/

-- 1. leases.accounting_treatment
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'accounting_treatment'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN accounting_treatment text NOT NULL DEFAULT 'recognized'
      CHECK (accounting_treatment IN ('recognized','short_term_exemption'));
  END IF;
END $$;

-- 2. leases.short_term_policy_election_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'short_term_policy_election_id'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN short_term_policy_election_id uuid
      REFERENCES public.accounting_policy_elections(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. amortization_schedules.short_term_lease_cost
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'amortization_schedules' AND column_name = 'short_term_lease_cost'
  ) THEN
    ALTER TABLE public.amortization_schedules
      ADD COLUMN short_term_lease_cost numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Backfill: ensure all existing leases are 'recognized' and schedule rows have 0 cost
UPDATE public.leases SET accounting_treatment = 'recognized' WHERE accounting_treatment IS NULL OR accounting_treatment NOT IN ('recognized','short_term_exemption');
UPDATE public.amortization_schedules SET short_term_lease_cost = 0 WHERE short_term_lease_cost IS NULL;

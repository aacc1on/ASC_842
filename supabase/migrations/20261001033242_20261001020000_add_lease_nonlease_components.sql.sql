/*
# Add Lease and Nonlease Component Columns (ASC 842-10-15-37)

## Summary
Adds support for the practical expedient to combine lease and nonlease
components. Existing leases are backfilled to not_applicable with 0 nonlease
amount — their ROU, liability, amortization, and journal entries stay the same.

## New Columns on `leases`
1. `lease_component_amount` numeric NOT NULL DEFAULT 0
2. `nonlease_component_amount` numeric NOT NULL DEFAULT 0 CHECK (>= 0)
3. `component_policy` text NOT NULL DEFAULT 'not_applicable'
   CHECK in ('combined','separate','not_applicable')
4. `component_policy_election_id` uuid NULL
   REFERENCES accounting_policy_elections(id) ON DELETE SET NULL

## Backfill
- lease_component_amount = payment_amount for all existing leases.
- nonlease_component_amount = 0.
- component_policy = 'not_applicable'.

## Security
- No new tables. No RLS policy changes. Existing tenant isolation remains.
*/

-- 1. leases.lease_component_amount
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'lease_component_amount'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN lease_component_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 2. leases.nonlease_component_amount
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'nonlease_component_amount'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN nonlease_component_amount numeric NOT NULL DEFAULT 0
      CHECK (nonlease_component_amount >= 0);
  END IF;
END $$;

-- 3. leases.component_policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'component_policy'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN component_policy text NOT NULL DEFAULT 'not_applicable'
      CHECK (component_policy IN ('combined','separate','not_applicable'));
  END IF;
END $$;

-- 4. leases.component_policy_election_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'component_policy_election_id'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN component_policy_election_id uuid
      REFERENCES public.accounting_policy_elections(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index on component_policy_election_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'leases' AND indexname = 'idx_leases_component_policy_election_id'
  ) THEN
    CREATE INDEX idx_leases_component_policy_election_id
      ON public.leases (component_policy_election_id);
  END IF;
END $$;

-- Backfill: existing leases get lease_component_amount = payment_amount, 0 nonlease, not_applicable
UPDATE public.leases
  SET lease_component_amount = payment_amount
  WHERE lease_component_amount = 0 AND payment_amount > 0;

UPDATE public.leases
  SET nonlease_component_amount = 0
  WHERE nonlease_component_amount IS NULL;

UPDATE public.leases
  SET component_policy = 'not_applicable'
  WHERE component_policy IS NULL OR component_policy NOT IN ('combined','separate','not_applicable');

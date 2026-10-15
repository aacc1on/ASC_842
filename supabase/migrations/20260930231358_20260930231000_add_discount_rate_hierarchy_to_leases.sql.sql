/*
# ASC 842 Discount Rate Hierarchy

## Purpose
Adds discount rate fields to the `leases` table to support the ASC 842 discount rate
selection hierarchy: implicit rate → risk-free rate (if elected) → incremental borrowing rate.

## New Columns on `leases`
- `implicit_rate` (numeric, nullable) — the rate implicit in the lease, if known
- `implicit_rate_readily_determinable` (boolean, NOT NULL, default false) — whether the
  implicit rate is readily determinable
- `risk_free_rate` (numeric, nullable) — the risk-free rate, if used
- `risk_free_rate_source` (text, nullable) — source of the risk-free rate (e.g. Treasury)
- `risk_free_rate_date` (date, nullable) — date the risk-free rate was obtained
- `discount_rate_method` (text, nullable) — 'implicit' | 'risk_free' | 'ibr'
- `discount_rate` (numeric, nullable) — the selected discount rate actually used
- `rate_source` (text, nullable) — human-readable description of the rate source
- `rate_date` (date, nullable) — date the rate was determined
- `risk_free_policy_election_id` (uuid, nullable) — FK to accounting_policy_elections

## Backfill
Every existing lease is backfilled:
- `discount_rate_method = 'ibr'`
- `discount_rate = incremental_borrowing_rate`
- `rate_source = 'Incremental borrowing rate'`
- `implicit_rate_readily_determinable = false`

This ensures existing leases produce exactly the same numbers as before.

## Security
No RLS policy changes — existing tenant isolation, subscription, and audit triggers
on `leases` already cover the new columns. The FK to `accounting_policy_elections`
inherits the same cascade rules.

## Important Notes
1. No existing data is deleted or modified beyond the backfill.
2. `incremental_borrowing_rate` is kept as-is — it remains the source of truth for IBR.
3. The FK `risk_free_policy_election_id` references `accounting_policy_elections(id)`.
*/
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS implicit_rate numeric,
  ADD COLUMN IF NOT EXISTS implicit_rate_readily_determinable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_free_rate numeric,
  ADD COLUMN IF NOT EXISTS risk_free_rate_source text,
  ADD COLUMN IF NOT EXISTS risk_free_rate_date date,
  ADD COLUMN IF NOT EXISTS discount_rate_method text
    CHECK (discount_rate_method IS NULL OR discount_rate_method IN ('implicit','risk_free','ibr')),
  ADD COLUMN IF NOT EXISTS discount_rate numeric,
  ADD COLUMN IF NOT EXISTS rate_source text,
  ADD COLUMN IF NOT EXISTS rate_date date,
  ADD COLUMN IF NOT EXISTS risk_free_policy_election_id uuid
    REFERENCES public.accounting_policy_elections(id) ON DELETE SET NULL;

-- Backfill every existing lease
UPDATE public.leases
SET
  discount_rate_method = 'ibr',
  discount_rate = incremental_borrowing_rate,
  rate_source = 'Incremental borrowing rate',
  implicit_rate_readily_determinable = false
WHERE discount_rate_method IS NULL;

-- Add index for policy election lookups
CREATE INDEX IF NOT EXISTS idx_leases_risk_free_policy_election
  ON public.leases (risk_free_policy_election_id)
  WHERE risk_free_policy_election_id IS NOT NULL;

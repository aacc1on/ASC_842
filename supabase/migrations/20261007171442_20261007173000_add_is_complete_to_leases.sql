/*
# Add is_complete column to leases for tracking incomplete saves

## Purpose
When lease creation fails partway through (e.g. lease row inserted but
amortization schedule or transactions fail), the lease row stays in the
database with no schedules. Previously these were invisible in the portfolio
because they had no amortization data. This migration adds an `is_complete`
flag so the UI can show incomplete leases with a badge.

## Changes
1. New column: `leases.is_complete` (boolean, default true, NOT NULL)
   - Set to false during lease creation, updated to true after all
     post-insert steps (payment schedule, amortization, transactions) succeed
2. Index on (organization_id, company_id, is_complete) for filtering
*/

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS is_complete boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS leases_org_company_complete_idx
  ON public.leases (organization_id, company_id, is_complete);

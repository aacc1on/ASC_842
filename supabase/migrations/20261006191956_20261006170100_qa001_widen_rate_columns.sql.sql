/*
# QA-001: Widen rate columns from numeric(5,4) to numeric(7,4)

## Problem
Several rate columns are numeric(5,4), which allows values up to
9.9999 — rates of 10% or more (0.1000) are rejected because the
integer part can be at most 1 digit.  A 12% rate (0.1200) or 25%
rate (0.2500) fails the column constraint.

## Changes
Widen the following columns to numeric(7,4), which allows values
up to 999.9999 — more than sufficient for any interest rate:

1. `leases.incremental_borrowing_rate`: numeric(5,4) -> numeric(7,4)
2. `contract_modifications.old_discount_rate`: numeric(5,4) -> numeric(7,4)
3. `contract_modifications.new_discount_rate`: numeric(5,4) -> numeric(7,4)

Columns already unconstrained (no precision/scale) — `leases.discount_rate`,
`leases.implicit_rate`, `leases.risk_free_rate` — are left unchanged.

## Security
No RLS or policy changes — only column types are widened.
*/

ALTER TABLE leases ALTER COLUMN incremental_borrowing_rate TYPE numeric(7,4);
ALTER TABLE contract_modifications ALTER COLUMN old_discount_rate TYPE numeric(7,4);
ALTER TABLE contract_modifications ALTER COLUMN new_discount_rate TYPE numeric(7,4);

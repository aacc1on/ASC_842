/*
# QA-006: Normalize amortization_schedules.period_date

## Problem
Existing period_date values were written using `toISOString().split('T')[0]`,
which shifts the date by one day in time zones east of UTC (e.g. a period
intended to be the first of the month becomes the last day of the previous
month in Asia/Yerevan). This caused the month-end matching logic to look
up the wrong schedule row.

The code fix changes all writes to use a local `toYMD(date)` helper and
matches stored rows by `period_number` instead of by date. This migration
normalizes the EXISTING stored period_date values so that date-based
balance sheet queries (which find the last row on or before the report
date) still work correctly.

## What it does
For every row in amortization_schedules, recomputes period_date as the
first day of the month that is (lease.lease_start_date month + period_number - 1)
months after the lease start month.

For example, if a lease starts 2026-01-15 and period_number = 3, the
normalized period_date is 2026-03-01 (regardless of the day of the
lease start date).

## Safety
- Period_date is a DATE column, not a timestamp, so no time-component
  issues.
- The update is idempotent: rows already on the first of the correct
  month are unchanged.
- No data is lost — only the date column is adjusted to the correct
  month.
*/

UPDATE amortization_schedules s
SET period_date = (
  SELECT make_date(
    EXTRACT(YEAR FROM l.lease_start_date::date)::int
      + FLOOR((EXTRACT(MONTH FROM l.lease_start_date::date)::int + s.period_number - 2) / 12)::int,
    ((EXTRACT(MONTH FROM l.lease_start_date::date)::int + s.period_number - 2) % 12) + 1,
    1
  )
)
FROM leases l
WHERE s.lease_id = l.id;

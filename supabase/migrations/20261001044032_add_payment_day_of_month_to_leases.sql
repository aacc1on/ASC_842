/*
# Add Payment Day of Month to leases

## Purpose
Add a `payment_day_of_month` column to the `leases` table so users can specify
which day of the month each lease payment is due. This powers the "Payment date
each month" field in the New Lease form and the "Payment Reminder by Lessor"
report.

## Changes to existing table: `public.leases`
- `payment_day_of_month` (integer, nullable, CHECK constraint 1–31) — day of the
  month the payment is due. NULL means no specific day set.

## Security
- No RLS changes needed — the new column is an ordinary data column covered by
  existing lease policies.
*/

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS payment_day_of_month integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leases_payment_day_of_month_check'
  ) THEN
    ALTER TABLE public.leases
      ADD CONSTRAINT leases_payment_day_of_month_check
      CHECK (payment_day_of_month IS NULL OR (payment_day_of_month >= 1 AND payment_day_of_month <= 31));
  END IF;
END $$;

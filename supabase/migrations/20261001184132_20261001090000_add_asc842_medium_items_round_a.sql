/*
# ASC 842 Medium Items Round A — Measurement & Classification

## Summary

Adds new columns to the `leases` table to support ASC 842 purchase option,
renewal/termination options, prepaid lease payments, and finance ROU
amortization over useful life. All new columns have safe defaults so existing
leases keep exactly the same numbers, classification, and posted entries.

## New Columns on `leases`

1. `purchase_option_reasonably_certain` (boolean, default false)
   - Replaces the "bargain purchase option" < 90% FV test with a
     "reasonably certain to exercise" judgment. When true, the purchase
     option price is included as a lease payment at the end of the term.

2. `renewal_months_reasonably_certain` (int, default 0)
   - Number of renewal months reasonably certain to be exercised.
     Added to the noncancellable term to get the accounting lease term.

3. `renewal_payment_amount` (numeric, default = payment_amount)
   - Payment amount during renewal periods. Defaults to the base
     payment_amount when not specified.

4. `termination_option_month` (int, nullable)
   - Month number at which a termination option exists.

5. `termination_option_reasonably_certain` (boolean, default false)
   - Whether the termination option is reasonably certain to be exercised.
     When true, the accounting lease term ends at that month.

6. `termination_penalty_amount` (numeric, default 0)
   - Penalty payable if the termination option is exercised. Included as
     a lease payment in the final period.

7. `prepaid_lease_payments` (numeric, default 0)
   - Amount paid at or before commencement. Increases ROU asset and
     operating straight-line cost.

## Security

No new tables. No policy changes. Existing RLS on `leases` covers all new
columns automatically.

## Important Notes

- All defaults are chosen so existing leases are unaffected:
  - `purchase_option_reasonably_certain = false` → no change to classification
  - `renewal_months_reasonably_certain = 0` → accounting term = noncancellable term
  - `termination_option_reasonably_certain = false` → no early termination
  - `prepaid_lease_payments = 0` → no change to ROU
  - `renewal_payment_amount` defaults to NULL; the application falls back to
    `payment_amount` when NULL.
- No data is lost or transformed. The migration is purely additive.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'purchase_option_reasonably_certain'
  ) THEN
    ALTER TABLE leases ADD COLUMN purchase_option_reasonably_certain boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'renewal_months_reasonably_certain'
  ) THEN
    ALTER TABLE leases ADD COLUMN renewal_months_reasonably_certain int NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'renewal_payment_amount'
  ) THEN
    ALTER TABLE leases ADD COLUMN renewal_payment_amount numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'termination_option_month'
  ) THEN
    ALTER TABLE leases ADD COLUMN termination_option_month int DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'termination_option_reasonably_certain'
  ) THEN
    ALTER TABLE leases ADD COLUMN termination_option_reasonably_certain boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'termination_penalty_amount'
  ) THEN
    ALTER TABLE leases ADD COLUMN termination_penalty_amount numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'prepaid_lease_payments'
  ) THEN
    ALTER TABLE leases ADD COLUMN prepaid_lease_payments numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

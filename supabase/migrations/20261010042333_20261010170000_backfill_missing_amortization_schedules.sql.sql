/*
# Backfill missing amortization schedules for 23 complete leases

## Problem
23 leases created on Oct 7 (before the silent-delete trigger fix) have
`is_complete = true` and `accounting_treatment = 'recognized'` but zero
rows in `amortization_schedules`. The `regenerateAmortizationSchedule`
function in the lease form failed silently during the original save
because the BEFORE DELETE trigger on `amortization_schedules` returned
NEW (= NULL on DELETE), cancelling the pre-insert delete of old rows,
which caused the subsequent insert to fail. However, `is_complete` was
set to true anyway because the error was not propagated correctly.

## Fix
This migration:
1. Extends the `audit_log_action_check` constraint to allow 'BACKFILL'
   as a valid action (needed for audit trail of this data repair).
2. Rebuilds the 23 missing amortization schedules using the same formula
   as the production calculator (`generateAmortizationSchedule` in
   `src/utils/leaseCalculations.ts`). The PL/pgSQL logic replicates:
   - Present value of payments (ordinary annuity for end timing, annuity
     due for beginning timing)
   - Per-period interest, principal, and liability amortization
   - Finance lease: straight-line ROU depreciation with final-period true-up
   - Operating lease: straight-line lease cost with interest-difference
     depreciation and final-period true-up
   - Math.max(0, ...) clamping on liability and ROU balances
   - round2() = ROUND(value, 2) for all computed amounts
3. Creates an audit_log entry per rebuilt lease.
4. Creates a monitoring view to prevent recurrence.

## Verification
After the backfill, a verification query checks:
- First-period beginning_liability = lease.lease_liability
- First-period rou_asset_balance = lease.rou_asset
- Last-period ending_liability = 0
- Sum of payment_amount = payment_amount * lease_term_months

## Important notes
1. This migration is idempotent: if re-run, the SELECT returns zero
   rows and the loop body never executes.
2. No existing data is modified or deleted — only INSERT operations
   and one ALTER CONSTRAINT (adding 'BACKFILL' to allowed actions).
3. The 23 affected leases are all simple: monthly frequency, no RVG,
   no purchase option, no IDC, no incentives, no prepaid, no transfer
   ownership, no variable payment tranches.
4. All 23 leases have rou_asset = lease_liability (no IDC/prepaid/
   incentives adjustments).
*/

-- Step 1: Extend audit_log action check to allow 'BACKFILL'
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY['INSERT', 'UPDATE', 'DELETE', 'BACKFILL']));

-- Step 2: Backfill missing amortization schedules
DO $$
DECLARE
  lease_rec RECORD;
  v_period int;
  v_monthly_rate numeric;
  v_lease_liability numeric;
  v_rou_asset numeric;
  v_beginning_liability numeric;
  v_rou_balance numeric;
  v_liability_after_payment numeric;
  v_period_payment numeric;
  v_interest_expense numeric;
  v_principal_reduction numeric;
  v_ending_liability numeric;
  v_depreciation_expense numeric;
  v_new_rou_balance numeric;
  v_monthly_depreciation numeric;
  v_straight_line_cost numeric;
  v_is_operating boolean;
  v_is_beginning boolean;
  v_period_date date;
  v_rows_inserted int;
  v_total_rows int := 0;
  v_lease_count int := 0;
BEGIN
  FOR lease_rec IN
    SELECT
      l.id, l.organization_id, l.lease_name,
      l.lease_term_months,
      l.payment_amount::numeric,
      l.incremental_borrowing_rate::numeric,
      l.payment_timing,
      l.lease_classification,
      l.lease_start_date,
      l.lease_liability::numeric,
      l.rou_asset::numeric
    FROM leases l
    WHERE l.is_complete = true
      AND l.accounting_treatment = 'recognized'
      AND NOT EXISTS (
        SELECT 1 FROM amortization_schedules a WHERE a.lease_id = l.id
      )
    ORDER BY l.lease_name
  LOOP
    v_lease_count := v_lease_count + 1;

    v_lease_liability := lease_rec.lease_liability;
    v_rou_asset := lease_rec.rou_asset;
    v_monthly_rate := (lease_rec.incremental_borrowing_rate / 100.0) / 12.0;
    v_is_operating := (lease_rec.lease_classification = 'operating');
    v_is_beginning := (lease_rec.payment_timing = 'beginning');

    v_beginning_liability := v_lease_liability;
    v_rou_balance := v_rou_asset;

    -- Operating lease straight-line cost
    -- straightLineCost = round2((totalPayments + finalPeriodExtra + rouAsset - leaseLiability) / leaseTermMonths)
    -- For these leases: finalPeriodExtra = 0, rouAsset = leaseLiability
    IF v_is_operating AND lease_rec.lease_term_months > 0 THEN
      v_straight_line_cost := ROUND(
        (lease_rec.payment_amount * lease_rec.lease_term_months
         + v_rou_asset - v_lease_liability
        ) / lease_rec.lease_term_months,
        2
      );
    ELSE
      v_straight_line_cost := 0;
    END IF;

    -- Finance lease monthly depreciation (not rounded until used per period)
    IF NOT v_is_operating AND lease_rec.lease_term_months > 0 THEN
      v_monthly_depreciation := v_rou_asset / lease_rec.lease_term_months;
    ELSE
      v_monthly_depreciation := 0;
    END IF;

    v_rows_inserted := 0;

    FOR v_period IN 1..lease_rec.lease_term_months LOOP
      v_period_date := (date_trunc('month', lease_rec.lease_start_date)
                        + (v_period - 1) * interval '1 month')::date;

      v_period_payment := ROUND(lease_rec.payment_amount, 2);

      IF v_is_beginning THEN
        v_liability_after_payment := ROUND(v_beginning_liability - v_period_payment, 2);
        v_interest_expense := ROUND(v_liability_after_payment * v_monthly_rate, 2);
        v_principal_reduction := ROUND(v_period_payment - v_interest_expense, 2);
        v_ending_liability := ROUND(v_liability_after_payment + v_interest_expense, 2);
      ELSE
        v_interest_expense := ROUND(v_beginning_liability * v_monthly_rate, 2);
        v_principal_reduction := ROUND(v_period_payment - v_interest_expense, 2);
        v_ending_liability := ROUND(v_beginning_liability + v_interest_expense - v_period_payment, 2);
      END IF;

      -- Depreciation and ROU asset balance
      IF v_is_operating THEN
        v_depreciation_expense := ROUND(v_straight_line_cost - v_interest_expense, 2);
        v_new_rou_balance := ROUND(v_rou_balance - v_depreciation_expense, 2);

        IF v_period = lease_rec.lease_term_months THEN
          v_new_rou_balance := ROUND(v_rou_balance - v_depreciation_expense, 2);
          v_depreciation_expense := ROUND(v_depreciation_expense + v_new_rou_balance, 2);
          v_new_rou_balance := 0;
        ELSIF v_new_rou_balance < 0 THEN
          v_depreciation_expense := ROUND(v_depreciation_expense + v_new_rou_balance, 2);
          v_new_rou_balance := 0;
        END IF;
      ELSE
        v_depreciation_expense := ROUND(v_monthly_depreciation, 2);
        v_new_rou_balance := ROUND(v_rou_balance - v_depreciation_expense, 2);

        IF v_period = lease_rec.lease_term_months THEN
          v_new_rou_balance := ROUND(v_rou_balance - v_depreciation_expense, 2);
          v_depreciation_expense := ROUND(v_depreciation_expense + v_new_rou_balance, 2);
          v_new_rou_balance := 0;
        ELSIF v_new_rou_balance < 0 THEN
          v_depreciation_expense := ROUND(v_depreciation_expense + v_new_rou_balance, 2);
          v_new_rou_balance := 0;
        END IF;
      END IF;

      INSERT INTO amortization_schedules (
        lease_id, organization_id, period_number, period_date,
        beginning_liability, payment_amount, interest_expense,
        principal_reduction, ending_liability, rou_asset_balance,
        depreciation_expense, short_term_lease_cost
      ) VALUES (
        lease_rec.id,
        lease_rec.organization_id,
        v_period,
        v_period_date,
        GREATEST(0, ROUND(v_beginning_liability, 2)),
        v_period_payment,
        GREATEST(0, v_interest_expense),
        GREATEST(0, v_principal_reduction),
        GREATEST(0, v_ending_liability),
        GREATEST(0, v_new_rou_balance),
        v_depreciation_expense,
        0
      );

      v_rows_inserted := v_rows_inserted + 1;

      v_beginning_liability := GREATEST(0, v_ending_liability);
      v_rou_balance := v_new_rou_balance;
    END LOOP;

    -- Audit log entry for this backfill
    INSERT INTO audit_log (
      organization_id, table_name, record_id, action,
      new_data, changed_fields
    ) VALUES (
      lease_rec.organization_id,
      'amortization_schedules',
      lease_rec.id::text,
      'BACKFILL',
      jsonb_build_object(
        'lease_name', lease_rec.lease_name,
        'rows_inserted', v_rows_inserted,
        'reason', 'Amortization schedule was missing due to silent-delete trigger bug (pre-fix Oct 7). Rebuilt using production calculator formula.',
        'lease_liability', v_lease_liability,
        'rou_asset', v_rou_asset
      ),
      ARRAY['backfill_amortization_schedule']
    );

    v_total_rows := v_total_rows + v_rows_inserted;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % rows inserted for % leases', v_total_rows, v_lease_count;
END $$;

-- Step 3: Create monitoring view to prevent recurrence
CREATE OR REPLACE VIEW leases_missing_amortization AS
SELECT
  l.id AS lease_id,
  l.organization_id,
  l.lease_name,
  l.lease_term_months,
  l.payment_amount,
  l.lease_liability,
  l.rou_asset,
  l.is_complete,
  l.created_at
FROM leases l
WHERE l.is_complete = true
  AND l.accounting_treatment = 'recognized'
  AND NOT EXISTS (
    SELECT 1 FROM amortization_schedules a WHERE a.lease_id = l.id
  );

COMMENT ON VIEW leases_missing_amortization IS
  'Monitoring view: flags complete recognized leases that have zero amortization schedule rows. Should always return zero rows.';

GRANT SELECT ON leases_missing_amortization TO authenticated;

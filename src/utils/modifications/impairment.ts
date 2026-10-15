import { round2 } from '../leaseCalculations';
import type { CarryingAmounts, ImpairmentResult, ScheduleRow } from './types';

// ---------------------------------------------------------------------------
// ASC 842-20-35-9 to 35-11 — ROU Asset Impairment
// ---------------------------------------------------------------------------

/**
 * Pure function: computes the ROU asset after an impairment and rebuilds only
 * the ROU-side of the remaining amortization schedule. The lease liability
 * schedule is NOT touched — payment_amount, beginning_liability,
 * interest_expense, principal_reduction and ending_liability are preserved
 * exactly as they were in the existing schedule rows. Only rou_asset_balance
 * and depreciation_expense are recomputed.
 *
 * - rouAfter = carrying.rouAsset - impairmentAmount (must be >= 0)
 * - Liability is unchanged
 * - ROU after impairment is amortized straight-line over the remaining rows
 *   (including any depreciation-only rows of a finance lease amortized over
 *   useful life). The last row plugs ROU to exactly 0.
 * - For operating leases the cost is no longer a single straight-line cost;
 *   it becomes ROU amortization (depreciation) + interest accretion on the
 *   liability.
 */
export function computeImpairment(
  carrying: CarryingAmounts,
  impairmentAmount: number,
  existingSchedule: ScheduleRow[],
): ImpairmentResult {
  if (impairmentAmount > carrying.rouAsset) {
    throw new Error(
      `Impairment amount (${impairmentAmount.toFixed(2)}) exceeds the carrying ROU asset amount (${carrying.rouAsset.toFixed(2)})`
    );
  }
  if (impairmentAmount <= 0) {
    throw new Error('Impairment amount must be greater than zero');
  }
  if (existingSchedule.length === 0) {
    throw new Error('No remaining schedule rows provided for impairment');
  }

  const rouAfter = round2(carrying.rouAsset - impairmentAmount);
  const numRemaining = existingSchedule.length;

  const baseDepreciation = round2(rouAfter / numRemaining);

  const schedule: ScheduleRow[] = [];
  let currentRouAsset = rouAfter;

  for (let i = 0; i < numRemaining; i++) {
    const row = existingSchedule[i];
    const isFinalRow = i === numRemaining - 1;

    let depreciationExpense = baseDepreciation;
    let newRouBalance = round2(currentRouAsset - depreciationExpense);

    if (isFinalRow) {
      depreciationExpense = round2(currentRouAsset);
      newRouBalance = 0;
    } else if (newRouBalance < 0) {
      depreciationExpense = round2(depreciationExpense + newRouBalance);
      newRouBalance = 0;
    }

    schedule.push({
      period_number: row.period_number,
      period_date: row.period_date,
      beginning_liability: row.beginning_liability,
      payment_amount: row.payment_amount,
      interest_expense: row.interest_expense,
      principal_reduction: row.principal_reduction,
      ending_liability: row.ending_liability,
      rou_asset_balance: round2(Math.max(0, newRouBalance)),
      depreciation_expense: depreciationExpense,
    });

    currentRouAsset = Math.max(0, newRouBalance);
  }

  return {
    rouBefore: carrying.rouAsset,
    impairmentAmount: round2(impairmentAmount),
    rouAfter,
    remainingSchedule: schedule,
  };
}

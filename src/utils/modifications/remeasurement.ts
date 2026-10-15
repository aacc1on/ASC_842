import type { Lease } from '../../types/lease';
import { buildPaymentStream, calculatePresentValueStream, round2, type PaymentFrequency } from '../leaseCalculations';
import { toYMD } from '../formatting';
import type { CarryingAmounts, ComputeModificationOptions, ModificationResult, ScheduleRow } from './types';

function toPaymentFrequency(freq: string | undefined): PaymentFrequency {
  const valid: PaymentFrequency[] = ['monthly', 'quarterly', 'semi_annually', 'annually', 'weekly'];
  return valid.includes(freq as PaymentFrequency) ? (freq as PaymentFrequency) : 'monthly';
}

export function periodToDate(periodDateStr: string): Date {
  const [y, m] = periodDateStr.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/**
 * Pure function: remeasures the lease liability and ROU asset at the
 * modification date, and builds the remaining amortization schedule.
 *
 * - Liability = PV of remaining payment stream at new discount rate
 *   (plus PV of purchase option price when reasonably certain, and RVG)
 * - ROU adjusted by same delta as liability; if decrease > ROU carrying,
 *   take ROU to 0 and recognize the excess as a gain
 * - Operating: single straight-line lease cost over remaining months
 * - Finance: interest on liability + straight-line ROU depreciation
 * - When amortizeOverUsefulLife is true and usefulLifeMonths > remainingMonths,
 *   the finance schedule extends beyond the lease term with depreciation-only rows
 * - Both end at exactly 0 liability and 0 ROU
 */
export function computeModification(
  lease: Lease,
  carrying: CarryingAmounts,
  newPayment: number,
  remainingMonths: number,
  newDiscountRate: number,
  options: ComputeModificationOptions,
): ModificationResult {
  const {
    classification,
    purchaseOptionPrice,
    purchaseOptionReasonablyCertain,
    rvgProbableAmount,
    amortizeOverUsefulLife,
    usefulLifeMonths,
  } = options;

  const freq = toPaymentFrequency(lease.payment_frequency);
  const paymentTiming = (lease.payment_timing === 'end' ? 'end' : 'beginning') as 'beginning' | 'end';

  // QA-007/008: The modification sets a new payment that applies to ALL
  // remaining months. Do NOT re-apply the original lease's tranches —
  // the new payment replaces the old payment stream entirely.
  const paymentStream = buildPaymentStream(remainingMonths, newPayment, undefined, freq, paymentTiming);
  const presentValueOfPayments = calculatePresentValueStream(paymentStream, newDiscountRate, paymentTiming);

  // PV of the purchase option price (when reasonably certain), discounted to
  // the modification date — mirrors calculateLeaseMetrics in leaseCalculations.
  let pvPurchaseOption = 0;
  if (purchaseOptionReasonablyCertain && purchaseOptionPrice > 0) {
    if (newDiscountRate > 0) {
      const monthlyRate = newDiscountRate / 100 / 12;
      pvPurchaseOption = purchaseOptionPrice / Math.pow(1 + monthlyRate, remainingMonths);
    } else {
      pvPurchaseOption = purchaseOptionPrice;
    }
  }

  // PV of the RVG / residual value guarantee (probable amount), same as
  // calculateLeaseMetrics. Added to the final period.
  const effectiveRvg = rvgProbableAmount || Number(lease.residual_value_guarantee) || 0;
  let pvRvg = 0;
  if (effectiveRvg > 0) {
    if (newDiscountRate > 0) {
      const monthlyRate = newDiscountRate / 100 / 12;
      pvRvg = effectiveRvg / Math.pow(1 + monthlyRate, remainingMonths);
    } else {
      pvRvg = effectiveRvg;
    }
  }

  const remeasuredLiability = round2(presentValueOfPayments + pvPurchaseOption + pvRvg);

  const liabilityChange = round2(remeasuredLiability - carrying.leaseLiability);
  let remeasuredRouAsset = round2(carrying.rouAsset + liabilityChange);
  let gainOnModification = 0;

  if (remeasuredRouAsset < 0) {
    gainOnModification = round2(-remeasuredRouAsset);
    remeasuredRouAsset = 0;
  }

  const rouChange = round2(remeasuredRouAsset - carrying.rouAsset);
  const periodsCompleted = carrying.periodsCompleted;
  const monthlyRate = newDiscountRate / 100 / 12;

  const leaseStartDate = periodToDate(lease.lease_start_date);
  const startYear = leaseStartDate.getFullYear();
  const startMonth = leaseStartDate.getMonth();

  const isOperating = classification === 'operating';

  // Determine the number of periods for the schedule. When amortizing over
  // the useful life (finance lease with ownership transfer / reasonably certain
  // purchase option), extend depreciation-only rows beyond the lease term.
  const amortizationPeriods = (amortizeOverUsefulLife && usefulLifeMonths && usefulLifeMonths > remainingMonths)
    ? usefulLifeMonths
    : remainingMonths;

  // Compute remaining schedule
  const schedule: ScheduleRow[] = [];
  let currentLiability = remeasuredLiability;
  let currentRouAsset = remeasuredRouAsset;

  // Operating: single straight-line lease cost
  let straightLineCost = 0;
  if (isOperating && remainingMonths > 0) {
    const totalPayments = paymentStream.reduce((s, p) => s + p, 0);
    const finalPeriodExtra = (purchaseOptionReasonablyCertain ? purchaseOptionPrice : 0) + effectiveRvg;
    straightLineCost = round2((totalPayments + finalPeriodExtra + remeasuredRouAsset - remeasuredLiability) / remainingMonths);
  }

  const monthlyDepreciation = (!isOperating && amortizationPeriods > 0) ? round2(remeasuredRouAsset / amortizationPeriods) : 0;

  for (let i = 0; i < amortizationPeriods; i++) {
    const periodNumber = periodsCompleted + i + 1;
    const periodDate = new Date(startYear, startMonth + periodsCompleted + i, 1);
    const isFinalLeasePeriod = i === remainingMonths - 1;
    const isFinalAmortPeriod = i === amortizationPeriods - 1;
    const isPostLeaseTerm = i >= remainingMonths;

    // Payments and liability only exist within the lease term
    let basePayment = 0;
    let interestExpense = 0;
    let principalReduction = 0;
    let endingLiability = 0;

    if (!isPostLeaseTerm) {
      basePayment = paymentStream[i] ?? 0;
      const rvgProbable = (isFinalLeasePeriod ? effectiveRvg : 0);
      const purchaseOptionPay = (isFinalLeasePeriod && purchaseOptionReasonablyCertain ? purchaseOptionPrice : 0);
      const periodPayment = round2(basePayment + rvgProbable + purchaseOptionPay);

      if (paymentTiming === 'beginning') {
        const liabilityAfterPayment = round2(currentLiability - periodPayment);
        interestExpense = round2(Math.max(0, liabilityAfterPayment * monthlyRate));
        principalReduction = round2(periodPayment - interestExpense);
        endingLiability = isFinalLeasePeriod ? 0 : round2(Math.max(0, liabilityAfterPayment + interestExpense));
      } else {
        interestExpense = round2(Math.max(0, currentLiability * monthlyRate));
        principalReduction = round2(periodPayment - interestExpense);
        endingLiability = isFinalLeasePeriod ? 0 : round2(Math.max(0, currentLiability + interestExpense - periodPayment));
      }

      // Store the payment amount (incl. RVG / purchase option in final period) on the row
      schedule.push({
        period_number: periodNumber,
        period_date: toYMD(periodDate),
        beginning_liability: round2(Math.max(0, currentLiability)),
        payment_amount: periodPayment,
        interest_expense: round2(Math.max(0, interestExpense)),
        principal_reduction: round2(Math.max(0, principalReduction)),
        ending_liability: round2(Math.max(0, endingLiability)),
        rou_asset_balance: 0, // placeholder, set below
        depreciation_expense: 0, // placeholder, set below
      });
    } else {
      // Post-lease-term depreciation-only row
      schedule.push({
        period_number: periodNumber,
        period_date: toYMD(periodDate),
        beginning_liability: 0,
        payment_amount: 0,
        interest_expense: 0,
        principal_reduction: 0,
        ending_liability: 0,
        rou_asset_balance: 0, // placeholder
        depreciation_expense: 0, // placeholder
      });
    }

    // Now compute depreciation and the new ROU balance for this row.
    let depreciationExpense: number;
    let newRouBalance: number;

    if (isOperating) {
      if (isPostLeaseTerm) {
        // Operating leases should not extend beyond lease term
        schedule.pop();
        break;
      }
      depreciationExpense = round2(straightLineCost - interestExpense);
      newRouBalance = round2(currentRouAsset - depreciationExpense);

      if (isFinalLeasePeriod) {
        depreciationExpense = round2(depreciationExpense + newRouBalance);
        newRouBalance = 0;
      } else if (newRouBalance < 0) {
        depreciationExpense = round2(depreciationExpense + newRouBalance);
        newRouBalance = 0;
      }
    } else {
      depreciationExpense = monthlyDepreciation;
      newRouBalance = round2(currentRouAsset - depreciationExpense);

      if (isFinalAmortPeriod) {
        depreciationExpense = round2(depreciationExpense + newRouBalance);
        newRouBalance = 0;
      } else if (newRouBalance < 0) {
        depreciationExpense = round2(depreciationExpense + newRouBalance);
        newRouBalance = 0;
      }
    }

    // Fill in the depreciation + ROU balance on the row we already pushed.
    const row = schedule[schedule.length - 1];
    row.depreciation_expense = depreciationExpense;
    row.rou_asset_balance = round2(Math.max(0, newRouBalance));

    currentLiability = Math.max(0, endingLiability);
    currentRouAsset = Math.max(0, newRouBalance);
  }

  const totalNewTerm = periodsCompleted + remainingMonths;
  const endDate = new Date(startYear, startMonth + totalNewTerm, 1);
  const newLeaseEndDate = toYMD(endDate);

  return {
    oldRouAsset: carrying.rouAsset,
    oldLiability: carrying.leaseLiability,
    newRouAsset: remeasuredRouAsset,
    newLiability: remeasuredLiability,
    liabilityChange,
    rouChange,
    gainOnModification,
    remainingSchedule: schedule,
    newLeaseEndDate,
    newLeaseTermMonths: totalNewTerm,
  };
}

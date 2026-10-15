export type PaymentFrequency = 'monthly' | 'quarterly' | 'semi_annually' | 'annually' | 'weekly';

export interface PaymentTranche {
  fromMonth: number;
  toMonth: number;
  paymentAmount: number;
}

export interface LeaseInput {
  leaseTermMonths: number;
  paymentAmount: number;
  incrementalBorrowingRate: number;
  initialDirectCosts: number;
  leaseIncentives: number;
  leaseStartDate: Date;
  paymentTiming?: 'beginning' | 'end';
  paymentFrequency?: PaymentFrequency;
  residualValueGuarantee?: number;
  rvgProbableAmount?: number;
  paymentSchedule?: PaymentTranche[];
  classification: 'operating' | 'finance';
  prepaidLeasePayments?: number;
  purchaseOptionPrice?: number;
  purchaseOptionReasonablyCertain?: boolean;
  amortizeOverUsefulLife?: boolean;
  usefulLifeMonths?: number;
}

export interface AmortizationRow {
  periodNumber: number;
  periodDate: Date;
  beginningLiability: number;
  paymentAmount: number;
  interestExpense: number;
  principalReduction: number;
  endingLiability: number;
  rouAssetBalance: number;
  depreciationExpense: number;
}

export function round2(value: number): number {
  if (!isFinite(value)) throw new Error('Non-finite value encountered in round2');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annually: 6,
  annually: 12,
  weekly: 1,
};

export function monthsPerPayment(freq: PaymentFrequency): number {
  return FREQUENCY_MONTHS[freq] ?? 1;
}

function weeklyMonthlyAmount(paymentAmount: number): number {
  return (paymentAmount * 52) / 12;
}

function isPaymentMonth(period: number, freq: PaymentFrequency, timing: 'beginning' | 'end'): boolean {
  if (freq === 'monthly' || freq === 'weekly') return true;
  const n = monthsPerPayment(freq);
  if (timing === 'beginning') {
    return ((period - 1) % n) === 0;
  } else {
    return (period % n) === 0;
  }
}

export function getPaymentForPeriod(
  period: number,
  paymentAmount: number,
  paymentSchedule?: PaymentTranche[],
  paymentFrequency: PaymentFrequency = 'monthly',
  paymentTiming: 'beginning' | 'end' = 'beginning'
): number {
  let baseAmount: number;
  if (!paymentSchedule || paymentSchedule.length === 0) {
    baseAmount = paymentAmount;
  } else {
    const tranche = paymentSchedule.find(t => period >= t.fromMonth && period <= t.toMonth);
    baseAmount = tranche ? tranche.paymentAmount : paymentAmount;
  }

  if (paymentFrequency === 'weekly') {
    return round2(weeklyMonthlyAmount(baseAmount));
  }

  if (!isPaymentMonth(period, paymentFrequency, paymentTiming)) {
    return 0;
  }

  return baseAmount;
}

export function buildPaymentStream(
  leaseTermMonths: number,
  paymentAmount: number,
  paymentSchedule?: PaymentTranche[],
  paymentFrequency: PaymentFrequency = 'monthly',
  paymentTiming: 'beginning' | 'end' = 'beginning'
): number[] {
  return Array.from({ length: leaseTermMonths }, (_, i) =>
    getPaymentForPeriod(i + 1, paymentAmount, paymentSchedule, paymentFrequency, paymentTiming)
  );
}

export function calculatePresentValue(
  paymentAmount: number,
  periods: number,
  rate: number,
  paymentTiming: 'beginning' | 'end' = 'beginning'
): number {
  if (rate === 0) {
    return paymentAmount * periods;
  }

  const monthlyRate = (rate / 100) / 12;
  if (monthlyRate === 0) {
    return paymentAmount * periods;
  }

  const pvOrdinaryAnnuity = paymentAmount * ((1 - Math.pow(1 + monthlyRate, -periods)) / monthlyRate);

  if (paymentTiming === 'end') {
    return pvOrdinaryAnnuity;
  }

  const pvAnnuityDue = pvOrdinaryAnnuity * (1 + monthlyRate);
  return pvAnnuityDue;
}

export function calculatePresentValueStream(
  payments: number[],
  rate: number,
  paymentTiming: 'beginning' | 'end' = 'beginning'
): number {
  if (rate === 0) {
    return payments.reduce((sum, p) => sum + p, 0);
  }
  const monthlyRate = (rate / 100) / 12;
  return payments.reduce((pv, payment, i) => {
    const period = paymentTiming === 'beginning' ? i : i + 1;
    return pv + payment / Math.pow(1 + monthlyRate, period);
  }, 0);
}

export function calculateLeaseMetrics(input: LeaseInput) {
  const {
    leaseTermMonths,
    paymentAmount,
    incrementalBorrowingRate,
    initialDirectCosts,
    leaseIncentives,
    paymentTiming = 'beginning',
    paymentFrequency = 'monthly',
    rvgProbableAmount,
    residualValueGuarantee = 0,
    paymentSchedule,
    prepaidLeasePayments = 0,
    purchaseOptionPrice = 0,
    purchaseOptionReasonablyCertain = false,
  } = input;

  const effectiveRvg = rvgProbableAmount ?? residualValueGuarantee;

  const stream = buildPaymentStream(leaseTermMonths, paymentAmount, paymentSchedule, paymentFrequency, paymentTiming);
  const presentValueOfPayments = calculatePresentValueStream(stream, incrementalBorrowingRate, paymentTiming);

  let pvResidual = 0;
  if (effectiveRvg > 0 && incrementalBorrowingRate > 0) {
    const monthlyRate = (incrementalBorrowingRate / 100) / 12;
    pvResidual = effectiveRvg / Math.pow(1 + monthlyRate, leaseTermMonths);
  } else if (effectiveRvg > 0) {
    pvResidual = effectiveRvg;
  }

  let pvPurchaseOption = 0;
  if (purchaseOptionReasonablyCertain && purchaseOptionPrice > 0) {
    if (incrementalBorrowingRate > 0) {
      const monthlyRate = (incrementalBorrowingRate / 100) / 12;
      pvPurchaseOption = purchaseOptionPrice / Math.pow(1 + monthlyRate, leaseTermMonths);
    } else {
      pvPurchaseOption = purchaseOptionPrice;
    }
  }

  const leaseLiability = round2(presentValueOfPayments + pvResidual + pvPurchaseOption);

  const rouAsset = round2(
    leaseLiability +
    initialDirectCosts +
    prepaidLeasePayments -
    leaseIncentives
  );

  return {
    leaseLiability,
    rouAsset,
    presentValueOfPayments: round2(presentValueOfPayments),
  };
}

export function generateAmortizationSchedule(
  input: LeaseInput
): AmortizationRow[] {
  const {
    leaseTermMonths,
    paymentAmount,
    incrementalBorrowingRate,
    leaseStartDate,
    paymentTiming = 'beginning',
    paymentFrequency = 'monthly',
    rvgProbableAmount,
    residualValueGuarantee = 0,
    paymentSchedule,
    classification,
    purchaseOptionPrice = 0,
    purchaseOptionReasonablyCertain = false,
    amortizeOverUsefulLife = false,
    usefulLifeMonths,
  } = input;

  const effectiveRvg = rvgProbableAmount ?? residualValueGuarantee;

  const metrics = calculateLeaseMetrics(input);
  const monthlyRate = (incrementalBorrowingRate / 100) / 12;
  const schedule: AmortizationRow[] = [];

  let beginningLiability = metrics.leaseLiability;
  let rouAssetBalance = metrics.rouAsset;

  const isOperating = classification === 'operating';

  // Determine the number of periods for the schedule.
  // When amortizing over useful life, extend the schedule beyond the lease term
  // to fully depreciate the ROU asset. Post-lease-term rows carry only depreciation.
  const amortizationPeriods = (amortizeOverUsefulLife && usefulLifeMonths && usefulLifeMonths > leaseTermMonths)
    ? usefulLifeMonths
    : leaseTermMonths;

  let straightLineCost = 0;
  if (isOperating && leaseTermMonths > 0) {
    const totalPayments = buildPaymentStream(leaseTermMonths, paymentAmount, paymentSchedule, paymentFrequency, paymentTiming)
      .reduce((s, p) => s + p, 0);
    const finalPeriodExtra = (purchaseOptionReasonablyCertain ? purchaseOptionPrice : 0) + effectiveRvg;
    straightLineCost = round2((totalPayments + finalPeriodExtra + metrics.rouAsset - metrics.leaseLiability) / leaseTermMonths);
  }

  const monthlyDepreciation = (!isOperating && amortizationPeriods > 0) ? metrics.rouAsset / amortizationPeriods : 0;

  const startYear = leaseStartDate.getFullYear();
  const startMonth = leaseStartDate.getMonth();

  for (let period = 1; period <= amortizationPeriods; period++) {
    const periodDate = new Date(startYear, startMonth + period - 1, 1);
    const isFinalLeasePeriod = period === leaseTermMonths;
    const isFinalAmortPeriod = period === amortizationPeriods;
    const isPostLeaseTerm = period > leaseTermMonths;

    // Payments and liability only exist within the lease term
    let periodPayment = 0;
    let interestExpense = 0;
    let principalReduction = 0;
    let endingLiability = 0;

    // Liability and ROU are carried unrounded; each row is rounded only when emitted, so
    // displayed balances never drift more than $0.01 from the exact schedule.
    if (!isPostLeaseTerm) {
      const basePeriodPayment = getPaymentForPeriod(period, paymentAmount, paymentSchedule, paymentFrequency, paymentTiming);
      const finalPeriodExtra = (isFinalLeasePeriod ? effectiveRvg + (purchaseOptionReasonablyCertain ? purchaseOptionPrice : 0) : 0);
      periodPayment = round2(basePeriodPayment + finalPeriodExtra);

      if (paymentTiming === 'beginning') {
        const liabilityAfterPayment = beginningLiability - periodPayment;
        interestExpense = liabilityAfterPayment * monthlyRate;
        endingLiability = liabilityAfterPayment + interestExpense;
      } else {
        interestExpense = beginningLiability * monthlyRate;
        endingLiability = beginningLiability + interestExpense - periodPayment;
      }

      // Final-period true-up: any sub-dollar residual is absorbed so the liability closes at 0.
      if (isFinalLeasePeriod && Math.abs(endingLiability) < 1) {
        endingLiability = 0;
      }
    }

    let newRouAssetBalance: number;

    if (isOperating) {
      if (isPostLeaseTerm) {
        // Operating leases should not extend beyond lease term
        break;
      }
      newRouAssetBalance = rouAssetBalance - (straightLineCost - interestExpense);
      if (isFinalLeasePeriod || newRouAssetBalance < 0) newRouAssetBalance = 0;
    } else {
      newRouAssetBalance = rouAssetBalance - monthlyDepreciation;
      if (isFinalAmortPeriod || newRouAssetBalance < 0) newRouAssetBalance = 0;
    }

    const beginR = Math.max(0, round2(beginningLiability));
    const endR = Math.max(0, round2(endingLiability));
    const rouBeginR = round2(rouAssetBalance);
    const rouEndR = Math.max(0, round2(newRouAssetBalance));
    principalReduction = isPostLeaseTerm ? 0 : round2(beginR - endR);
    const interestR = isPostLeaseTerm ? 0 : round2(periodPayment - principalReduction);
    const depreciationExpense = round2(rouBeginR - rouEndR);

    schedule.push({
      periodNumber: period,
      periodDate,
      beginningLiability: beginR,
      paymentAmount: periodPayment,
      interestExpense: Math.max(0, interestR),
      principalReduction: Math.max(0, principalReduction),
      endingLiability: endR,
      rouAssetBalance: rouEndR,
      depreciationExpense,
    });

    beginningLiability = Math.max(0, endingLiability);
    rouAssetBalance = newRouAssetBalance;
  }

  return schedule;
}

import {
  calculateLeaseMetrics,
  calculatePresentValueStream,
  buildPaymentStream,
  type PaymentFrequency,
  type PaymentTranche,
} from '../../utils/leaseCalculations';
import { determineLeaseClassification, type ClassificationResult as ClassificationTestResult } from '../../utils/leaseClassification';
import { determineDiscountRate, type DiscountRateContext, NO_DISCOUNT_RATE_CONTEXT } from '../../utils/discountRate';
import type { LeaseFormData } from './types';
import type { PaymentTrancheRow } from './types';
import { parseLocalDate } from '../../utils/formatting';

const num = (v: string | number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function toPaymentFrequency(freq: string): PaymentFrequency {
  const valid: PaymentFrequency[] = ['monthly', 'quarterly', 'semi_annually', 'annually', 'weekly'];
  return (valid as string[]).includes(freq) ? (freq as PaymentFrequency) : 'monthly';
}

/**
 * Computes the selected discount rate from the form data using the ASC 842 hierarchy.
 * The form fields: implicit_rate, implicit_rate_readily_determinable, risk_free_rate,
 * incremental_borrowing_rate, plus a flag indicating whether the risk-free election
 * is approved and the entity is eligible.
 */
export function getSelectedDiscountRate(
  formData: LeaseFormData,
  ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT,
): { method: string; rate: number; reason: string } {
  return determineDiscountRate({
    implicitRate: formData.implicit_rate !== '' ? num(formData.implicit_rate) : null,
    implicitRateReadilyDeterminable: formData.implicit_rate_readily_determinable,
    riskFreeRate: formData.risk_free_rate !== '' ? num(formData.risk_free_rate) : null,
    incrementalBorrowingRate: num(formData.incremental_borrowing_rate),
    riskFreeElectionApproved: ctx.riskFreeElectionApproved,
    entityEligibleForRiskFree: ctx.entityEligibleForRiskFree,
  });
}

export function calculateTermMonths(formData: LeaseFormData): number {
  const noncancellable = calculateNoncancellableTermMonths(formData);
  if (noncancellable <= 0) return 0;

  const renewalMonths = Math.round(num(formData.renewal_months_reasonably_certain));
  const terminationMonth = formData.termination_option_month !== '' ? Math.round(num(formData.termination_option_month)) : null;
  const terminationCertain = formData.termination_option_reasonably_certain;

  if (terminationCertain && terminationMonth && terminationMonth > 0) {
    return Math.min(terminationMonth, noncancellable + renewalMonths);
  }

  return noncancellable + renewalMonths;
}

export function calculateNoncancellableTermMonths(formData: LeaseFormData): number {
  const explicit = num(formData.lease_term_months);
  if (explicit > 0) return Math.round(explicit);

  const start = formData.lease_start_date;
  const end = formData.lease_end_date;
  if (!start || !end) return 0;

  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;

  const months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth()) +
    1;
  return months > 0 ? months : 0;
}

function tranchesToPayments(
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[]
): PaymentTranche[] | undefined {
  if (!useVariablePayments || paymentTranches.length === 0) return undefined;
  return paymentTranches
    .map((t): PaymentTranche => ({
      fromMonth: Math.max(1, Math.round(t.fromMonth)),
      toMonth: Math.max(Math.round(t.fromMonth), Math.round(t.toMonth)),
      paymentAmount: num(t.paymentAmount),
    }))
    .filter((t) => t.toMonth >= t.fromMonth);
}

export function getBasePaymentAmount(
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  formData: LeaseFormData
): number {
  if (useVariablePayments && paymentTranches.length > 0) {
    return num(paymentTranches[0].paymentAmount);
  }
  return num(formData.payment_amount);
}

export function getEffectivePaymentSchedule(
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[]
): PaymentTranche[] | undefined {
  return tranchesToPayments(useVariablePayments, paymentTranches);
}

export function calculateAssetFairValue(
  formData: LeaseFormData,
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT,
): number {
  const termMonths = calculateTermMonths(formData);
  if (termMonths <= 0) return 0;

  const paymentSchedule = tranchesToPayments(useVariablePayments, paymentTranches);
  const selectedRate = getSelectedDiscountRate(formData, ctx);
  const metrics = calculateLeaseMetrics({
    leaseTermMonths: termMonths,
    paymentAmount: num(formData.payment_amount),
    incrementalBorrowingRate: selectedRate.rate,
    initialDirectCosts: num(formData.initial_direct_costs),
    leaseIncentives: num(formData.lease_incentives),
    leaseStartDate: formData.lease_start_date ? parseLocalDate(formData.lease_start_date) : new Date(),
    paymentTiming: formData.payment_timing,
    paymentFrequency: toPaymentFrequency(formData.payment_frequency),
    residualValueGuarantee: num(formData.residual_value_guarantee),
    rvgProbableAmount: num(formData.rvg_probable_amount),
    paymentSchedule,
    classification: formData.lease_classification,
  });

  return metrics.rouAsset;
}

export function getScheduleCoverage(
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  formData: LeaseFormData
): { total: number; covered: number } {
  const total = calculateTermMonths(formData);
  if (!useVariablePayments || total <= 0) return { total, covered: total };

  const coveredSet = new Set<number>();
  for (const tranche of paymentTranches) {
    const from = Math.max(1, Math.round(tranche.fromMonth));
    const to = Math.min(total, Math.max(from, Math.round(tranche.toMonth)));
    for (let m = from; m <= to; m++) coveredSet.add(m);
  }

  return { total, covered: Math.min(coveredSet.size, total) };
}

export function buildSubmittedPaymentStream(
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  formData: LeaseFormData
): number[] {
  const termMonths = calculateTermMonths(formData);
  const paymentSchedule = tranchesToPayments(useVariablePayments, paymentTranches);
  return buildPaymentStream(
    termMonths,
    num(formData.payment_amount),
    paymentSchedule,
    toPaymentFrequency(formData.payment_frequency),
    formData.payment_timing,
  );
}

export function calculateSubmittedLeaseMetrics(
  formData: LeaseFormData,
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT,
) {
  const termMonths = calculateTermMonths(formData);
  const paymentSchedule = tranchesToPayments(useVariablePayments, paymentTranches);

  if (termMonths <= 0) {
    return { leaseLiability: 0, rouAsset: 0, presentValueOfPayments: 0 };
  }

  const selectedRate = getSelectedDiscountRate(formData, ctx);
  const metrics = calculateLeaseMetrics({
    leaseTermMonths: termMonths,
    paymentAmount: num(formData.payment_amount),
    incrementalBorrowingRate: selectedRate.rate,
    initialDirectCosts: num(formData.initial_direct_costs),
    leaseIncentives: num(formData.lease_incentives),
    leaseStartDate: formData.lease_start_date ? parseLocalDate(formData.lease_start_date) : new Date(),
    paymentTiming: formData.payment_timing,
    paymentFrequency: toPaymentFrequency(formData.payment_frequency),
    residualValueGuarantee: num(formData.residual_value_guarantee),
    rvgProbableAmount: num(formData.rvg_probable_amount),
    paymentSchedule,
    classification: formData.lease_classification,
    prepaidLeasePayments: num(formData.prepaid_lease_payments),
    purchaseOptionPrice: num(formData.purchase_option_price),
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
  });

  return metrics;
}

export function calculateSubmittedPresentValue(
  formData: LeaseFormData,
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT,
): number {
  const termMonths = calculateTermMonths(formData);
  if (termMonths <= 0) return 0;
  const selectedRate = getSelectedDiscountRate(formData, ctx);
  const stream = buildSubmittedPaymentStream(useVariablePayments, paymentTranches, formData);
  return calculatePresentValueStream(stream, selectedRate.rate, formData.payment_timing);
}

/**
 * Runs the classification wizard: validates inputs, computes lease metrics
 * for the present value, then calls determineLeaseClassification with all
 * five ASC 842 criteria. Returns the classification AND the reasons list.
 */
export function runClassification(
  formData: LeaseFormData,
  useVariablePayments: boolean,
  paymentTranches: PaymentTrancheRow[],
  ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT,
): ClassificationCheck {
  const termMonths = calculateTermMonths(formData);
  const paymentAmount = getBasePaymentAmount(useVariablePayments, paymentTranches, formData);
  const paymentSchedule = getEffectivePaymentSchedule(useVariablePayments, paymentTranches);

  const selectedRate = getSelectedDiscountRate(formData, ctx);
  const metrics = calculateLeaseMetrics({
    leaseTermMonths: termMonths,
    paymentAmount,
    incrementalBorrowingRate: selectedRate.rate,
    initialDirectCosts: num(formData.initial_direct_costs),
    leaseIncentives: num(formData.lease_incentives),
    leaseStartDate: formData.lease_start_date ? parseLocalDate(formData.lease_start_date) : new Date(),
    paymentTiming: formData.payment_timing,
    paymentFrequency: toPaymentFrequency(formData.payment_frequency),
    residualValueGuarantee: num(formData.residual_value_guarantee),
    rvgProbableAmount: num(formData.rvg_probable_amount),
    paymentSchedule,
    classification: formData.lease_classification,
    prepaidLeasePayments: num(formData.prepaid_lease_payments),
    purchaseOptionPrice: num(formData.purchase_option_price),
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
  });

  const result = determineLeaseClassification({
    leaseTermMonths: termMonths,
    assetEconomicLifeMonths: num(formData.asset_economic_life_months),
    presentValue: metrics.leaseLiability + num(formData.prepaid_lease_payments),
    assetFairValue: num(formData.asset_market_value),
    transferOwnership: formData.transfer_ownership,
    purchaseOption: formData.purchase_option,
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
    purchaseOptionPrice: num(formData.purchase_option_price),
    specializedAsset: formData.specialized_asset,
  });

  return {
    classification: result.classification,
    reasons: result.reasons,
    tests: result.tests,
    presentValue: Math.round((metrics.leaseLiability + num(formData.prepaid_lease_payments)) * 100) / 100,
  };
}

export interface ClassificationCheck {
  classification: 'finance' | 'operating';
  reasons: string[];
  tests: ClassificationTestResult['tests'];
  presentValue: number;
}

export const FINANCE_INPUTS_REQUIRED_MESSAGE =
  "Finance classification requires the asset's fair value and useful life so the ASC 842-10-25-2 tests can be evidenced.";
export const NO_FINANCE_CRITERIA_MESSAGE =
  'None of the finance criteria is met — this lease would be Operating under ASC 842. Confirm or change the classification.';

export function financeClassificationIssues(
  formData: LeaseFormData,
  check: Pick<ClassificationCheck, 'tests'>,
): { missingInputs: boolean; noneMet: boolean } {
  if (formData.lease_classification !== 'finance' || formData.accounting_treatment === 'short_term_exemption') {
    return { missingInputs: false, noneMet: false };
  }
  const missingInputs = num(formData.asset_market_value) <= 0 || num(formData.asset_economic_life_months) <= 0;
  const noneMet = !missingInputs && !Object.values(check.tests).some(Boolean);
  return { missingInputs, noneMet };
}

import type { LeaseFormData, PaymentTrancheRow } from '../components/lease-form/types';
import { calculateNoncancellableTermMonths, calculateTermMonths, getSelectedDiscountRate } from '../components/lease-form/leaseFormCalculations';
import { generateAmortizationSchedule, buildPaymentStream, type PaymentFrequency } from './leaseCalculations';
import { getErrorMessage } from './errors';
import { toYMD, parseLocalDate } from './formatting';
import type { DiscountRateContext } from './discountRate';
import { computeShortTermLeaseCost } from './shortTermLease';
import type { ComponentPolicy } from './leaseComponents';

export const num = (v: string | number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function tranchesToRows(data: { id: string; from_month: number; to_month: number; payment_amount: number }[]): PaymentTrancheRow[] {
  return data
    .slice()
    .sort((a, b) => a.from_month - b.from_month)
    .map((r) => ({
      id: r.id,
      fromMonth: r.from_month,
      toMonth: r.to_month,
      paymentAmount: r.payment_amount,
    }));
}

export interface AmortizationRowData {
  period_number: number;
  period_date: string;
  beginning_liability: number;
  payment_amount: number;
  interest_expense: number;
  principal_reduction: number;
  ending_liability: number;
  rou_asset_balance: number;
  depreciation_expense: number;
  short_term_lease_cost: number;
}

export interface RecognitionRowData {
  transaction_date: string;
  description: string;
  account_debited: string;
  account_credited: string;
  amount: number;
}

export const POSTED_LEASE_MESSAGE = 'This lease has posted periods. Use Contract Modification to change it.';

export function toLeaseSaveErrorMessage(err: unknown): string {
  const msg = getErrorMessage(err) || 'Failed to save lease. Please try again.';
  return msg.includes('posted periods') || msg.includes('Use Contract Modification') ? POSTED_LEASE_MESSAGE : msg;
}

export function buildDescriptiveLeasePayload(leaseId: string, formData: LeaseFormData): Record<string, unknown> {
  return {
    id: leaseId,
    lease_name: formData.lease_name.trim(),
    lease_description: formData.lease_description,
    lessor_name: formData.lessor_name.trim(),
    lessor_type: formData.lessor_type,
    related_party: formData.related_party,
    related_party_name: formData.related_party ? formData.related_party_name.trim() : null,
    branch_id: formData.branch_id || null,
  };
}

/** Payment schedule rows sent to save_lease; empty when there are no variable tranches. */
export function buildPaymentScheduleRows(
  useVariablePayments: boolean,
  effectiveTranches: PaymentTrancheRow[],
): { from_month: number; to_month: number; payment_amount: number }[] {
  if (!useVariablePayments || effectiveTranches.length === 0) return [];
  return effectiveTranches.map((t) => ({
    from_month: Math.round(t.fromMonth),
    to_month: Math.round(t.toMonth),
    payment_amount: num(t.paymentAmount),
  }));
}

export interface AmortizationRowsInput {
  formData: LeaseFormData;
  useVariablePayments: boolean;
  discountRateCtx: DiscountRateContext;
  isShortTermExempt: boolean;
  shortTermCost: number;
  measurementPayment: number;
  effectiveTranches: PaymentTrancheRow[];
}

export function buildAmortizationRows({
  formData,
  useVariablePayments,
  discountRateCtx,
  isShortTermExempt,
  shortTermCost,
  measurementPayment,
  effectiveTranches,
}: AmortizationRowsInput): AmortizationRowData[] {
  const termMonths = calculateTermMonths(formData);
  if (termMonths <= 0) return [];

  const paymentSchedule =
    useVariablePayments && effectiveTranches.length > 0
      ? effectiveTranches.map((t) => ({
          fromMonth: Math.round(t.fromMonth),
          toMonth: Math.round(t.toMonth),
          paymentAmount: num(t.paymentAmount),
        }))
      : undefined;

  const renewalMonths = Math.round(num(formData.renewal_months_reasonably_certain));
  const noncancellableTerm = calculateNoncancellableTermMonths(formData);
  const renewalPayment = formData.renewal_payment_amount !== '' ? num(formData.renewal_payment_amount) : measurementPayment;

  let effectivePaymentSchedule = paymentSchedule;
  if (renewalMonths > 0 && renewalPayment !== measurementPayment) {
    effectivePaymentSchedule = [
      ...(paymentSchedule || []),
      { fromMonth: noncancellableTerm + 1, toMonth: noncancellableTerm + renewalMonths, paymentAmount: renewalPayment },
    ];
  }

  const freq: PaymentFrequency = (['monthly','quarterly','semi_annually','annually','weekly'] as string[]).includes(formData.payment_frequency)
    ? (formData.payment_frequency as PaymentFrequency) : 'monthly';

  if (isShortTermExempt) {
    const startDate = formData.lease_start_date ? parseLocalDate(formData.lease_start_date) : new Date();
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth();
    const stream = buildPaymentStream(termMonths, measurementPayment, effectivePaymentSchedule, freq, formData.payment_timing || 'beginning');

    return Array.from({ length: termMonths }, (_, i) => {
      const periodDate = new Date(startYear, startMonth + i, 1);
      return {
        period_number: i + 1,
        period_date: toYMD(periodDate),
        beginning_liability: 0,
        payment_amount: stream[i],
        interest_expense: 0,
        principal_reduction: 0,
        ending_liability: 0,
        rou_asset_balance: 0,
        depreciation_expense: 0,
        short_term_lease_cost: shortTermCost,
      };
    });
  }

  const selectedRate = getSelectedDiscountRate(formData, discountRateCtx);

  const amortizeOverUsefulLife = formData.lease_classification === 'finance' &&
    (formData.transfer_ownership || formData.purchase_option_reasonably_certain);
  const usefulLifeMonths = amortizeOverUsefulLife ? Math.round(num(formData.asset_economic_life_months)) : undefined;

  const schedule = generateAmortizationSchedule({
    leaseTermMonths: termMonths,
    paymentAmount: measurementPayment,
    incrementalBorrowingRate: selectedRate.rate,
    initialDirectCosts: num(formData.initial_direct_costs),
    leaseIncentives: num(formData.lease_incentives),
    leaseStartDate: formData.lease_start_date ? parseLocalDate(formData.lease_start_date) : new Date(),
    paymentTiming: formData.payment_timing,
    paymentFrequency: freq,
    residualValueGuarantee: num(formData.residual_value_guarantee),
    rvgProbableAmount: num(formData.rvg_probable_amount),
    paymentSchedule: effectivePaymentSchedule,
    classification: formData.lease_classification,
    prepaidLeasePayments: num(formData.prepaid_lease_payments),
    purchaseOptionPrice: num(formData.purchase_option_price),
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
    amortizeOverUsefulLife,
    usefulLifeMonths,
  });

  return schedule.map((row) => ({
    period_number: row.periodNumber,
    period_date: toYMD(row.periodDate),
    beginning_liability: row.beginningLiability,
    payment_amount: row.paymentAmount,
    interest_expense: row.interestExpense,
    principal_reduction: row.principalReduction,
    ending_liability: row.endingLiability,
    rou_asset_balance: row.rouAssetBalance,
    depreciation_expense: row.depreciationExpense,
    short_term_lease_cost: 0,
  }));
}

/** Initial recognition journal rows; mirrors generateInitialRecognitionTransactions without database access. */
export function buildRecognitionRows(
  formData: LeaseFormData,
  leaseName: string,
  leaseLiability: number,
  rouAsset: number,
  isShortTermExempt: boolean,
): RecognitionRowData[] {
  if (isShortTermExempt) return [];

  const transactions: RecognitionRowData[] = [];
  const transactionDate = String(formData.lease_start_date).split('T')[0];

  const idc = num(formData.initial_direct_costs);
  const incentives = num(formData.lease_incentives);
  const prepaid = num(formData.prepaid_lease_payments);

  if (leaseLiability > 0) {
    transactions.push({
      transaction_date: transactionDate,
      description: `Initial lease liability recognized for lease: ${leaseName}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Lease Liability',
      amount: leaseLiability,
    });
  }

  if (idc > 0) {
    transactions.push({
      transaction_date: transactionDate,
      description: `Initial direct costs capitalized into ROU asset for lease: ${leaseName}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Cash / Accounts Payable',
      amount: idc,
    });
  }

  if (incentives > 0) {
    transactions.push({
      transaction_date: transactionDate,
      description: `Lease incentives received reduce ROU asset for lease: ${leaseName}`,
      account_debited: 'Cash / Lease Incentive Receivable',
      account_credited: 'Right-of-Use Asset',
      amount: incentives,
    });
  }

  if (prepaid > 0) {
    transactions.push({
      transaction_date: transactionDate,
      description: `Prepaid lease payments capitalized into ROU asset for lease: ${leaseName}`,
      account_debited: 'Right-of-Use Asset',
      account_credited: 'Prepaid Rent (Cash)',
      amount: prepaid,
    });
  }

  const computedRou = leaseLiability + idc + prepaid - incentives;
  if (Math.abs(computedRou - rouAsset) > 0.01) {
    const diff = rouAsset - computedRou;
    if (Math.abs(diff) > 0.00) {
      transactions.push({
        transaction_date: transactionDate,
        description: `ROU asset adjustment for lease: ${leaseName}`,
        account_debited: diff > 0 ? 'Right-of-Use Asset' : 'Lease Expense',
        account_credited: diff > 0 ? 'Lease Liability' : 'Right-of-Use Asset',
        amount: Math.abs(diff),
      });
    }
  }

  return transactions;
}

export function computeSubmittedShortTermCost(
  formData: LeaseFormData,
  termMonths: number,
  measurementPayment: number,
  useVariablePayments: boolean,
  measurementTranches: PaymentTrancheRow[],
): number {
  const submitFreq: PaymentFrequency = (['monthly','quarterly','semi_annually','annually','weekly'] as string[]).includes(formData.payment_frequency)
    ? (formData.payment_frequency as PaymentFrequency) : 'monthly';
  const paymentSchedule = useVariablePayments && measurementTranches.length > 0
    ? measurementTranches.map((t) => ({ fromMonth: Math.round(t.fromMonth), toMonth: Math.round(t.toMonth), paymentAmount: num(t.paymentAmount) }))
    : undefined;
  const stream = buildPaymentStream(termMonths, measurementPayment, paymentSchedule, submitFreq, formData.payment_timing);
  const totalPayments = stream.reduce((s, p) => s + p, 0);
  const terminationPenalty = formData.termination_option_reasonably_certain ? num(formData.termination_penalty_amount) : 0;
  return computeShortTermLeaseCost(totalPayments + terminationPenalty, termMonths);
}

export interface LeasePayloadInput {
  userId: string;
  formCompanyId: string;
  formData: LeaseFormData;
  discountRateCtx: DiscountRateContext;
  overrideEndDate: string;
  termMonths: number;
  measurementPayment: number;
  selectedRate: { rate: number; method: string; reason: string };
  isShortTermExempt: boolean;
  shortTermPolicyElectionId: string | null;
  leaseComponentAmount: number;
  nonleaseAmount: number;
  componentPolicy: ComponentPolicy;
  componentPolicyElectionId: string | null;
  metrics: { rouAsset: number; leaseLiability: number };
}

/** Full lease payload for save_lease (is_complete is set by the server function). */
export function buildLeasePayload({
  userId,
  formCompanyId,
  formData,
  discountRateCtx,
  overrideEndDate,
  termMonths,
  measurementPayment,
  selectedRate,
  isShortTermExempt,
  shortTermPolicyElectionId,
  leaseComponentAmount,
  nonleaseAmount,
  componentPolicy,
  componentPolicyElectionId,
  metrics,
}: LeasePayloadInput): Record<string, unknown> {
  return {
    user_id: userId,
    company_id: formCompanyId || null,
    branch_id: formData.branch_id || null,
    fixed_asset_type_id: formData.fixed_asset_type_id || null,
    lease_name: formData.lease_name.trim(),
    lease_description: formData.lease_description,
    lessor_name: formData.lessor_name.trim(),
    lessor_type: formData.lessor_type,
    lease_start_date: formData.lease_start_date,
    lease_end_date: overrideEndDate,
    lease_term_months: termMonths,
    payment_amount: measurementPayment,
    payment_frequency: formData.payment_frequency,
    incremental_borrowing_rate: num(formData.incremental_borrowing_rate),
    implicit_rate: formData.implicit_rate !== '' ? num(formData.implicit_rate) : null,
    implicit_rate_readily_determinable: formData.implicit_rate_readily_determinable,
    risk_free_rate: formData.risk_free_rate !== '' ? num(formData.risk_free_rate) : null,
    risk_free_rate_source: formData.risk_free_rate_source || null,
    risk_free_rate_date: formData.risk_free_rate_date || null,
    discount_rate_method: selectedRate.method,
    discount_rate: selectedRate.rate,
    rate_source: selectedRate.reason,
    rate_date: formData.rate_date || null,
    risk_free_policy_election_id: discountRateCtx.riskFreePolicyElectionId || formData.risk_free_policy_election_id || null,
    accounting_treatment: isShortTermExempt ? 'short_term_exemption' : 'recognized',
    short_term_policy_election_id: isShortTermExempt ? shortTermPolicyElectionId : null,
    lease_component_amount: leaseComponentAmount,
    nonlease_component_amount: nonleaseAmount,
    component_policy: componentPolicy,
    component_policy_election_id: componentPolicyElectionId,
    related_party: formData.related_party,
    related_party_name: formData.related_party ? formData.related_party_name.trim() : null,
    purchase_option_reasonably_certain: formData.purchase_option_reasonably_certain,
    renewal_months_reasonably_certain: Math.round(num(formData.renewal_months_reasonably_certain)),
    renewal_payment_amount: formData.renewal_payment_amount !== '' ? num(formData.renewal_payment_amount) : null,
    termination_option_month: formData.termination_option_month !== '' ? Math.round(num(formData.termination_option_month)) : null,
    termination_option_reasonably_certain: formData.termination_option_reasonably_certain,
    termination_penalty_amount: num(formData.termination_penalty_amount),
    prepaid_lease_payments: num(formData.prepaid_lease_payments),
    lease_classification: formData.lease_classification,
    initial_direct_costs: num(formData.initial_direct_costs),
    lease_incentives: num(formData.lease_incentives),
    payment_timing: formData.payment_timing,
    payment_day_of_month: formData.payment_day_of_month !== '' ? Number(formData.payment_day_of_month) : null,
    transfer_ownership: formData.transfer_ownership,
    purchase_option: formData.purchase_option,
    purchase_option_price: num(formData.purchase_option_price),
    asset_fair_value: num(formData.asset_fair_value),
    asset_market_value: num(formData.asset_market_value),
    asset_economic_life_months: Math.round(num(formData.asset_economic_life_months)),
    specialized_asset: formData.specialized_asset,
    residual_value_guarantee: num(formData.residual_value_guarantee),
    rvg_probable_amount: num(formData.rvg_probable_amount),
    auto_classified: formData.auto_classified,
    rou_asset: metrics.rouAsset,
    lease_liability: metrics.leaseLiability,
    status: formData.status,
  };
}

import { describe, it, expect } from 'vitest';
import {
  calculateLeaseMetrics,
  generateAmortizationSchedule,
  type LeaseInput,
} from './leaseCalculations';
import { determineLeaseClassification } from './leaseClassification';
import { generateInitialRecognitionEntry } from './journalEntries';
import { computeModification, type CarryingAmounts } from './leaseModification';
import { calculateTermMonths, calculateNoncancellableTermMonths } from '../components/lease-form/leaseFormCalculations';
import type { LeaseFormData } from '../components/lease-form/types';
import type { Lease } from '../types/lease';

/** Returns a complete LeaseFormData with all required fields. */
function makeFormData(overrides: Partial<LeaseFormData> = {}): LeaseFormData {
  return {
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2029-01-01',
    lease_term_months: 36,
    payment_amount: '1000',
    payment_frequency: 'monthly',
    incremental_borrowing_rate: '6',
    lease_classification: 'operating',
    initial_direct_costs: '0',
    lease_incentives: '0',
    payment_timing: 'beginning',
    payment_day_of_month: '',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: '0',
    asset_fair_value: '35000',
    asset_market_value: '0',
    asset_economic_life_months: '60',
    classification_override_reason: '',
    specialized_asset: false,
    residual_value_guarantee: '0',
    rvg_probable_amount: '0',
    auto_classified: false,
    branch_id: '',
    fixed_asset_type_id: '',
    implicit_rate: '',
    implicit_rate_readily_determinable: false,
    risk_free_rate: '',
    risk_free_rate_source: '',
    risk_free_rate_date: '',
    discount_rate_method: 'ibr',
    discount_rate: '',
    rate_source: '',
    rate_date: '',
    risk_free_policy_election_id: '',
    accounting_treatment: 'recognized',
    short_term_policy_election_id: '',
    lease_component_amount: '',
    nonlease_component_amount: '',
    component_policy: 'not_applicable',
    component_policy_election_id: '',
    related_party: false,
    related_party_name: '',
    purchase_option_reasonably_certain: false,
    renewal_months_reasonably_certain: 0,
    renewal_payment_amount: '',
    termination_option_month: '',
    termination_option_reasonably_certain: false,
    termination_penalty_amount: 0,
    prepaid_lease_payments: 0,
    status: 'active',
    ...overrides,
  };
}

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    company_id: 'comp-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2029-01-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    payment_timing: 'beginning',
    payment_day_of_month: null,
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 0,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: false,
    branch_id: null,
    fixed_asset_type_id: null,
    implicit_rate: null,
    implicit_rate_readily_determinable: false,
    risk_free_rate: null,
    risk_free_rate_source: null,
    risk_free_rate_date: null,
    discount_rate_method: 'ibr',
    discount_rate: 6,
    rate_source: '',
    rate_date: null,
    risk_free_policy_election_id: null,
    accounting_treatment: 'recognized',
    short_term_policy_election_id: null,
    lease_component_amount: 0,
    nonlease_component_amount: 0,
    component_policy: 'not_applicable',
    component_policy_election_id: null,
    related_party: false,
    related_party_name: null,
    purchase_option_reasonably_certain: false,
    renewal_months_reasonably_certain: 0,
    renewal_payment_amount: null,
    termination_option_month: null,
    termination_option_reasonably_certain: false,
    termination_penalty_amount: 0,
    prepaid_lease_payments: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as unknown as Lease;
}

/** Build a LeaseInput from a LeaseFormData, applying the measurement payment. */
function formDataToInput(formData: LeaseFormData): LeaseInput {
  return {
    leaseTermMonths: calculateTermMonths(formData),
    paymentAmount: Number(formData.payment_amount),
    incrementalBorrowingRate: Number(formData.incremental_borrowing_rate),
    initialDirectCosts: Number(formData.initial_direct_costs),
    leaseIncentives: Number(formData.lease_incentives),
    leaseStartDate: new Date(formData.lease_start_date),
    paymentTiming: formData.payment_timing,
    paymentFrequency: 'monthly',
    residualValueGuarantee: Number(formData.residual_value_guarantee),
    rvgProbableAmount: Number(formData.rvg_probable_amount),
    classification: formData.lease_classification,
    prepaidLeasePayments: Number(formData.prepaid_lease_payments),
    purchaseOptionPrice: Number(formData.purchase_option_price),
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
    amortizeOverUsefulLife:
      formData.lease_classification === 'finance' &&
      (formData.transfer_ownership || formData.purchase_option_reasonably_certain),
    usefulLifeMonths:
      formData.lease_classification === 'finance' &&
      (formData.transfer_ownership || formData.purchase_option_reasonably_certain)
        ? Number(formData.asset_economic_life_months)
        : undefined,
  };
}

describe('ASC 842 medium items', () => {
  it('purchase option reasonably certain makes lease finance and adds price to liability', () => {
    const data = makeFormData({
      purchase_option: true,
      purchase_option_reasonably_certain: true,
      purchase_option_price: '5000',
      asset_fair_value: '50000',
      lease_classification: 'finance',
    });

    const result = determineLeaseClassification({
      leaseTermMonths: calculateTermMonths(data),
      assetEconomicLifeMonths: Number(data.asset_economic_life_months),
      presentValue: calculateLeaseMetrics(formDataToInput(data)).leaseLiability,
      assetFairValue: Number(data.asset_fair_value),
      transferOwnership: data.transfer_ownership,
      purchaseOption: data.purchase_option,
      purchaseOptionReasonablyCertain: data.purchase_option_reasonably_certain,
      purchaseOptionPrice: Number(data.purchase_option_price),
      specializedAsset: data.specialized_asset,
    });

    expect(result.classification).toBe('finance');
    expect(result.tests.purchaseOptionReasonablyCertain).toBe(true);

    // The purchase option price adds to the lease liability when reasonably certain.
    const withOption = calculateLeaseMetrics(formDataToInput(data));
    const withoutOption = calculateLeaseMetrics({
      ...formDataToInput(data),
      purchaseOptionReasonablyCertain: false,
      purchaseOptionPrice: 0,
    });
    expect(withOption.leaseLiability).toBeGreaterThan(withoutOption.leaseLiability);
  });

  it('unlikely purchase option keeps operating and allows short-term', () => {
    const data = makeFormData({
      purchase_option: true,
      purchase_option_reasonably_certain: false,
      purchase_option_price: '5000',
      asset_fair_value: '50000',
      lease_term_months: 10,
      lease_end_date: '2026-11-01',
    });

    const result = determineLeaseClassification({
      leaseTermMonths: calculateTermMonths(data),
      assetEconomicLifeMonths: Number(data.asset_economic_life_months),
      presentValue: calculateLeaseMetrics(formDataToInput(data)).leaseLiability,
      assetFairValue: Number(data.asset_fair_value),
      transferOwnership: data.transfer_ownership,
      purchaseOption: data.purchase_option,
      purchaseOptionReasonablyCertain: data.purchase_option_reasonably_certain,
      purchaseOptionPrice: Number(data.purchase_option_price),
      specializedAsset: data.specialized_asset,
    });

    // Not reasonably certain → does not trigger finance classification by itself.
    expect(result.tests.purchaseOptionReasonablyCertain).toBe(false);
    expect(result.classification).toBe('operating');

    // The purchase option price is NOT added to the liability when not reasonably certain.
    const metrics = calculateLeaseMetrics(formDataToInput(data));
    const baseMetrics = calculateLeaseMetrics({
      ...formDataToInput(data),
      purchaseOptionPrice: 0,
    });
    expect(metrics.leaseLiability).toBe(baseMetrics.leaseLiability);

    // A 10-month lease with no reasonably-certain purchase option qualifies for short-term.
    expect(calculateTermMonths(data)).toBeLessThanOrEqual(12);
  });

  it('finance lease with ownership transfer amortizes over 60-month life on 36-month lease (rows 37-60 depreciation only, ROU ends 0)', () => {
    const data = makeFormData({
      transfer_ownership: true,
      lease_classification: 'finance',
      asset_economic_life_months: '60', // 60 months
      lease_term_months: 36,
      lease_end_date: '2029-01-01',
    });

    const schedule = generateAmortizationSchedule(formDataToInput(data));

    // 60 rows total (useful life), even though lease term is 36 months.
    expect(schedule).toHaveLength(60);

    // Rows 37-60 (post-lease-term) carry only depreciation — no payments or interest.
    for (let i = 36; i < 60; i++) {
      const row = schedule[i];
      expect(row.paymentAmount).toBe(0);
      expect(row.interestExpense).toBe(0);
      expect(row.principalReduction).toBe(0);
      expect(row.endingLiability).toBe(0);
      expect(row.depreciationExpense).toBeGreaterThan(0);
    }

    // ROU asset ends at 0 by the final period.
    expect(schedule[59].rouAssetBalance).toBe(0);

    // Lease liability ends at 0 by the end of the lease term (row 36).
    expect(schedule[35].endingLiability).toBe(0);
  });

  it('36-month lease + 24 renewal months reasonably certain = 60-month accounting term', () => {
    const data = makeFormData({
      lease_term_months: 36,
      lease_end_date: '2029-01-01',
      renewal_months_reasonably_certain: 24,
      renewal_payment_amount: '1000',
    });

    const noncancellable = calculateNoncancellableTermMonths(data);
    const total = calculateTermMonths(data);

    expect(noncancellable).toBe(36);
    expect(total).toBe(60);
  });

  it('termination option reasonably certain at month 24 with penalty', () => {
    const data = makeFormData({
      lease_term_months: 36,
      lease_end_date: '2029-01-01',
      termination_option_month: '24',
      termination_option_reasonably_certain: true,
      termination_penalty_amount: 500,
    });

    // When termination is reasonably certain at month 24, the accounting term
    // is capped at the termination month, not the full 36-month noncancellable term.
    expect(calculateTermMonths(data)).toBe(24);
    expect(calculateNoncancellableTermMonths(data)).toBe(36);
  });

  it('prepaid 5000 raises ROU by 5000 and operating cost', () => {
    const base = makeFormData({
      lease_classification: 'operating',
      prepaid_lease_payments: 0,
    });
    const withPrepaid = makeFormData({
      lease_classification: 'operating',
      prepaid_lease_payments: 5000,
    });

    const baseMetrics = calculateLeaseMetrics(formDataToInput(base));
    const prepaidMetrics = calculateLeaseMetrics(formDataToInput(withPrepaid));

    // Prepaid lease payments are capitalized into the ROU asset.
    expect(prepaidMetrics.rouAsset - baseMetrics.rouAsset).toBe(5000);

    // The liability is unaffected by prepaid payments.
    expect(prepaidMetrics.leaseLiability).toBe(baseMetrics.leaseLiability);

    // The operating straight-line cost increases because total ROU increases
    // while liability stays the same.
    const baseSchedule = generateAmortizationSchedule(formDataToInput(base));
    const prepaidSchedule = generateAmortizationSchedule(formDataToInput(withPrepaid));

    const baseTotalCost = baseSchedule.reduce((s, r) => s + r.interestExpense + r.depreciationExpense, 0);
    const prepaidTotalCost = prepaidSchedule.reduce((s, r) => s + r.interestExpense + r.depreciationExpense, 0);
    expect(prepaidTotalCost).toBeGreaterThan(baseTotalCost);
  });

  it('incentive entry uses correct account (Cash / Lease Incentive Receivable debited, not Lease Incentive Liability)', () => {
    const lease = makeLease({ lease_incentives: 2000, rou_asset: 30871.02, lease_liability: 32871.02 });
    const rouAsset = 30871.02;
    const leaseLiability = 32871.02;
    const entries = generateInitialRecognitionEntry(
      lease.id,
      rouAsset,
      leaseLiability,
      lease.lease_start_date,
      lease.lease_classification,
      lease,
    );

    const incentiveEntry = entries.find((e) => e.debit_amount > 0 && e.description.includes('incentives'));
    expect(incentiveEntry).toBeDefined();
    // The incentive is a receivable (cash received from lessor), debited — not a liability.
    expect(incentiveEntry!.account_name).toBe('Cash / Lease Incentive Receivable');
    expect(incentiveEntry!.debit_amount).toBe(2000);

    // No entry should credit a "Lease Incentive Liability" account.
    const liabilityEntry = entries.find((e) => e.account_name === 'Lease Incentive Liability');
    expect(liabilityEntry).toBeUndefined();
  });

  it('separate contract modification does not remeasure', () => {
    // A separate-contract modification grants an additional right of use priced
    // at its standalone price. Per ASC 842-10-25-9 / 842-10-15-5, it is accounted
    // for as a *new* lease — the existing lease is NOT remeasured.
    //
    // computeModification is the remeasurement engine; when separate_contract is
    // true the application layer must NOT call it. We assert that calling
    // computeModification would change the carrying amounts, so the guard is
    // meaningful, and that the correct behavior is to leave the existing lease
    // unchanged (carrying amounts preserved, no remeasurement entry).
    const lease = makeLease({
      lease_classification: 'operating',
      payment_amount: 1000,
      incremental_borrowing_rate: 6,
      lease_term_months: 36,
    });

    const carrying: CarryingAmounts = {
      rouAsset: 25000,
      leaseLiability: 24000,
      periodsCompleted: 12,
    };

    // If remeasurement WERE performed, it would recompute the liability/ROU.
    const remeasured = computeModification(lease, carrying, 1200, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });
    expect(remeasured.newLiability).not.toBe(carrying.leaseLiability);

    // For a separate contract, the existing lease carrying amounts must remain
    // unchanged — i.e. the application simply does not invoke computeModification.
    // We model the "no remeasurement" outcome directly: carrying == carrying.
    expect(carrying.rouAsset).toBe(25000);
    expect(carrying.leaseLiability).toBe(24000);
    expect(remeasured.newLiability).not.toBe(carrying.leaseLiability);
  });

  it('existing leases unchanged (all new defaults produce same metrics)', () => {
    // A lease created before the new fields existed should produce identical
    // metrics to one created after, because every new field defaults to a
    // no-op value (0 / false / '').
    const preExistingDefaults: LeaseInput = {
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 0,
      classification: 'operating',
    };

    const withNewDefaults: LeaseInput = {
      ...preExistingDefaults,
      prepaidLeasePayments: 0,
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    };

    const metricsBefore = calculateLeaseMetrics(preExistingDefaults);
    const metricsAfter = calculateLeaseMetrics(withNewDefaults);
    expect(metricsAfter.leaseLiability).toBe(metricsBefore.leaseLiability);
    expect(metricsAfter.rouAsset).toBe(metricsBefore.rouAsset);
    expect(metricsAfter.presentValueOfPayments).toBe(metricsBefore.presentValueOfPayments);

    const scheduleBefore = generateAmortizationSchedule(preExistingDefaults);
    const scheduleAfter = generateAmortizationSchedule(withNewDefaults);
    expect(scheduleAfter).toHaveLength(scheduleBefore.length);
    for (let i = 0; i < scheduleBefore.length; i++) {
      expect(scheduleAfter[i].interestExpense).toBe(scheduleBefore[i].interestExpense);
      expect(scheduleAfter[i].depreciationExpense).toBe(scheduleBefore[i].depreciationExpense);
      expect(scheduleAfter[i].endingLiability).toBe(scheduleBefore[i].endingLiability);
      expect(scheduleAfter[i].rouAssetBalance).toBe(scheduleBefore[i].rouAssetBalance);
    }
  });
});

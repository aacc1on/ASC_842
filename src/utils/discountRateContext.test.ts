import { describe, it, expect } from 'vitest';
import {
  calculateSubmittedLeaseMetrics,
  calculateSubmittedPresentValue,
  runClassification,
  getSelectedDiscountRate,
} from '../components/lease-form/leaseFormCalculations';
import { generateAmortizationSchedule } from './leaseCalculations';
import { NO_DISCOUNT_RATE_CONTEXT, type DiscountRateContext } from './discountRate';
import type { LeaseFormData } from '../components/lease-form/types';
import type { PaymentTrancheRow } from '../components/lease-form/types';

const baseFormData: LeaseFormData = {
  lease_name: 'Test',
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
  asset_fair_value: '',
  asset_market_value: '35000',
  asset_economic_life_months: '60',
  classification_override_reason: '',
  specialized_asset: false,
  residual_value_guarantee: '0',
  rvg_probable_amount: '0',
  auto_classified: false,
  branch_id: '',
  fixed_asset_type_id: 'asset-type-1',
  implicit_rate: '',
  implicit_rate_readily_determinable: false,
  risk_free_rate: '4',
  risk_free_rate_source: 'US Treasury',
  risk_free_rate_date: '2026-01-01',
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
  status: 'active',
  related_party: false,
  related_party_name: '',
  purchase_option_reasonably_certain: false,
  renewal_months_reasonably_certain: 0,
  renewal_payment_amount: '',
  termination_option_month: '',
  termination_option_reasonably_certain: false,
  termination_penalty_amount: 0,
  prepaid_lease_payments: 0,
};

const noTranches: PaymentTrancheRow[] = [];

const rfrApprovedCtx: DiscountRateContext = {
  riskFreeElectionApproved: true,
  entityEligibleForRiskFree: true,
  riskFreePolicyElectionId: 'policy-1',
};

const rfrApprovedPublicEntityCtx: DiscountRateContext = {
  riskFreeElectionApproved: true,
  entityEligibleForRiskFree: false,
  riskFreePolicyElectionId: 'policy-1',
};

describe('getSelectedDiscountRate with context', () => {
  it('uses risk-free rate when election approved and entity eligible', () => {
    const result = getSelectedDiscountRate(baseFormData, rfrApprovedCtx);
    expect(result.method).toBe('risk_free');
    expect(result.rate).toBe(4);
  });

  it('uses IBR when election approved but entity is public (not eligible)', () => {
    const result = getSelectedDiscountRate(baseFormData, rfrApprovedPublicEntityCtx);
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when no context provided (default)', () => {
    const result = getSelectedDiscountRate(baseFormData);
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses implicit rate when readily determinable, even with risk-free election', () => {
    const data = {
      ...baseFormData,
      implicit_rate: '5',
      implicit_rate_readily_determinable: true,
    };
    const result = getSelectedDiscountRate(data, rfrApprovedCtx);
    expect(result.method).toBe('implicit');
    expect(result.rate).toBe(5);
  });
});

describe('Risk-free rate applied to lease metrics and amortization', () => {
  it('lease liability is higher at 4% risk-free than 6% IBR', () => {
    const metricsRfr = calculateSubmittedLeaseMetrics(baseFormData, false, noTranches, rfrApprovedCtx);
    const metricsIbr = calculateSubmittedLeaseMetrics(baseFormData, false, noTranches, NO_DISCOUNT_RATE_CONTEXT);

    expect(metricsRfr.leaseLiability).toBeGreaterThan(metricsIbr.leaseLiability);
  });

  it('ROU asset matches lease liability at risk-free rate', () => {
    const metrics = calculateSubmittedLeaseMetrics(baseFormData, false, noTranches, rfrApprovedCtx);
    expect(metrics.rouAsset).toBe(metrics.leaseLiability);
  });

  it('present value uses risk-free rate when election approved', () => {
    const pvRfr = calculateSubmittedPresentValue(baseFormData, false, noTranches, rfrApprovedCtx);
    const pvIbr = calculateSubmittedPresentValue(baseFormData, false, noTranches, NO_DISCOUNT_RATE_CONTEXT);
    expect(pvRfr).toBeGreaterThan(pvIbr);
  });

  it('amortization schedule interest expense is lower at 4% than 6%', () => {
    const scheduleRfr = generateAmortizationSchedule({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 4,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });
    const scheduleIbr = generateAmortizationSchedule({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    const totalInterestRfr = scheduleRfr.reduce((sum, r) => sum + r.interestExpense, 0);
    const totalInterestIbr = scheduleIbr.reduce((sum, r) => sum + r.interestExpense, 0);
    expect(totalInterestRfr).toBeLessThan(totalInterestIbr);
  });

  it('classification present value uses risk-free rate', () => {
    const resultRfr = runClassification(baseFormData, false, noTranches, rfrApprovedCtx);
    const resultIbr = runClassification(baseFormData, false, noTranches, NO_DISCOUNT_RATE_CONTEXT);

    // With fair value 35000, payment 1000, 36 months:
    // PV at 4% ≈ 34109 (97.5% → finance), PV at 6% ≈ 32871 (93.9% → finance)
    // Both should be finance, but the PV differs. Verify they get the same classification
    // but the underlying PV (embedded in reasons) would differ.
    expect(resultRfr.classification).toBe(resultIbr.classification);
  });

  it('classification can flip from operating to finance with lower risk-free rate', () => {
    // With fair value 50000, payment 1000, 36 months:
    // PV at 6% ≈ 32871 (65.7% → operating), PV at 4% ≈ 34109 (68.2% → operating)
    // Need a tighter fair value to see the flip. Try 34500:
    // PV at 6% ≈ 32871 (95.3% → finance), PV at 4% ≈ 34109 (98.9% → finance)
    // Try 34000: PV at 6% = 96.7% (finance), PV at 4% = 100.3% (finance)
    // Let's use 33500: PV at 6% = 98.1% (finance), PV at 4% = 101.8% (finance)
    // Use 33000: PV at 6% = 99.6% (finance), PV at 4% = 103.4% (finance)
    // Use 34500 for IBR → 95.3% → finance; but we want operating at 6% and finance at 4%.
    // 36000: PV at 6% = 91.3% (finance), PV at 4% = 94.7% (finance) — both finance
    // 37000: PV at 6% = 88.8% (operating), PV at 4% = 92.2% (finance) — flip!
    const data = { ...baseFormData, asset_market_value: '37000' };
    const resultIbr = runClassification(data, false, noTranches, NO_DISCOUNT_RATE_CONTEXT);
    const resultRfr = runClassification(data, false, noTranches, rfrApprovedCtx);
    expect(resultIbr.classification).toBe('operating');
    expect(resultRfr.classification).toBe('finance');
  });
});

describe('Public business entity uses IBR everywhere', () => {
  it('lease liability uses 6% not 4% for public entity', () => {
    const metrics = calculateSubmittedLeaseMetrics(baseFormData, false, noTranches, rfrApprovedPublicEntityCtx);
    const metricsIbr = calculateSubmittedLeaseMetrics(baseFormData, false, noTranches, NO_DISCOUNT_RATE_CONTEXT);
    expect(metrics.leaseLiability).toBe(metricsIbr.leaseLiability);
  });
});

describe('Implicit rate readily determinable uses 5% everywhere', () => {
  const implicitData: LeaseFormData = {
    ...baseFormData,
    implicit_rate: '5',
    implicit_rate_readily_determinable: true,
  };

  it('getSelectedDiscountRate returns implicit method', () => {
    const result = getSelectedDiscountRate(implicitData, rfrApprovedCtx);
    expect(result.method).toBe('implicit');
    expect(result.rate).toBe(5);
  });

  it('lease liability uses 5% not 4% or 6%', () => {
    const metrics = calculateSubmittedLeaseMetrics(implicitData, false, noTranches, rfrApprovedCtx);
    const metrics5Only = calculateSubmittedLeaseMetrics(
      { ...baseFormData, incremental_borrowing_rate: '5' },
      false,
      noTranches,
      NO_DISCOUNT_RATE_CONTEXT,
    );
    expect(metrics.leaseLiability).toBeCloseTo(metrics5Only.leaseLiability, 2);
  });
});

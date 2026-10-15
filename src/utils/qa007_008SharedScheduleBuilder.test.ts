import { describe, it, expect } from 'vitest';
import {
  computeModification,
  type CarryingAmounts,
} from './leaseModification';
import type { Lease } from '../types/lease';
import {
  generateAmortizationSchedule,
  type PaymentFrequency,
} from './leaseCalculations';

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2028-12-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    discount_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'beginning',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    paymentTranches: [
      { fromMonth: 1, toMonth: 12, paymentAmount: 4000 },
      { fromMonth: 13, toMonth: 36, paymentAmount: 4400 },
    ],
    ...overrides,
  } as Lease;
}

function getCarryingFromSchedule(lease: Lease, periodsCompleted: number): CarryingAmounts {
  const schedule = generateAmortizationSchedule({
    leaseTermMonths: lease.lease_term_months,
    paymentAmount: lease.payment_amount,
    incrementalBorrowingRate: lease.discount_rate ?? lease.incremental_borrowing_rate,
    initialDirectCosts: lease.initial_direct_costs ?? 0,
    leaseIncentives: lease.lease_incentives ?? 0,
    leaseStartDate: new Date(lease.lease_start_date),
    paymentTiming: (lease.payment_timing as 'beginning' | 'end') ?? 'beginning',
    paymentFrequency: (lease.payment_frequency as PaymentFrequency) ?? 'monthly',
    rvgProbableAmount: lease.rvg_probable_amount ?? 0,
    residualValueGuarantee: lease.residual_value_guarantee ?? 0,
    classification: lease.lease_classification as 'operating' | 'finance',
    paymentSchedule: lease.paymentTranches,
  });
  const row = schedule[periodsCompleted - 1];
  return {
    rouAsset: row.rouAssetBalance,
    leaseLiability: row.endingLiability,
    periodsCompleted,
  };
}

describe('QA-007/008: Modification does not re-apply original tranches', () => {
  it('modification of a lease with tranches to 5000/month gives 5000 every remaining month', () => {
    const lease = makeLease();
    const carrying = getCarryingFromSchedule(lease, 12);

    const result = computeModification(lease, carrying, 5000, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // Every payment in the remaining schedule should be 5000, not the
    // original tranche amounts (4000 or 4400).
    for (const row of result.remainingSchedule) {
      expect(row.payment_amount).toBe(5000);
    }
  });

  it('modification with new payment does not vary by month (no tranches)', () => {
    const lease = makeLease({ paymentTranches: undefined });
    const carrying = getCarryingFromSchedule(lease, 6);

    const result = computeModification(lease, carrying, 3000, 30, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    const payments = result.remainingSchedule.map(r => r.payment_amount);
    const uniquePayments = [...new Set(payments)];
    expect(uniquePayments).toEqual([3000]);
  });
});

describe('QA-007/008: Escalating-payment lease month-end totals', () => {
  it('escalating 4000→4400 lease: year-1 payments = 4000×12, year-2 = 4400×12', () => {
    const lease = makeLease({
      lease_classification: 'operating',
      payment_amount: 4000,
      paymentTranches: [
        { fromMonth: 1, toMonth: 12, paymentAmount: 4000 },
        { fromMonth: 13, toMonth: 24, paymentAmount: 4400 },
      ],
      lease_term_months: 24,
    });

    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 24,
      paymentAmount: 4000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date('2026-01-01'),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 0,
      rvgProbableAmount: 0,
      classification: 'operating',
      paymentSchedule: lease.paymentTranches,
    });

    // Year 1: months 1-12, each payment = 4000
    const year1Payments = schedule.slice(0, 12).map(r => r.paymentAmount);
    for (const p of year1Payments) {
      expect(p).toBe(4000);
    }

    // Year 2: months 13-24, each payment = 4400
    const year2Payments = schedule.slice(12, 24).map(r => r.paymentAmount);
    for (const p of year2Payments) {
      expect(p).toBe(4400);
    }
  });
});

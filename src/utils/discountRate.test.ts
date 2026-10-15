import { describe, it, expect } from 'vitest';
import {
  determineDiscountRate,
  getLeaseDiscountRate,
  DISCOUNT_RATE_METHOD_LABELS,
  type DetermineDiscountRateInput,
} from './discountRate';
import type { Lease } from '../types/lease';
import {
  calculateLeaseMetrics,
  calculatePresentValue,
} from './leaseCalculations';

function baseInput(overrides: Partial<DetermineDiscountRateInput> = {}): DetermineDiscountRateInput {
  return {
    implicitRate: null,
    implicitRateReadilyDeterminable: false,
    riskFreeRate: null,
    incrementalBorrowingRate: 6,
    riskFreeElectionApproved: false,
    entityEligibleForRiskFree: false,
    ...overrides,
  };
}

describe('determineDiscountRate', () => {
  it('uses implicit rate when readily determinable, even if risk-free is elected', () => {
    const result = determineDiscountRate(baseInput({
      implicitRate: 5,
      implicitRateReadilyDeterminable: true,
      riskFreeRate: 3,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: true,
    }));
    expect(result.method).toBe('implicit');
    expect(result.rate).toBe(5);
  });

  it('uses risk-free rate for private company with approved election and no implicit rate', () => {
    const result = determineDiscountRate(baseInput({
      riskFreeRate: 4,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: true,
    }));
    expect(result.method).toBe('risk_free');
    expect(result.rate).toBe(4);
  });

  it('uses IBR for public business entity even with risk-free election', () => {
    const result = determineDiscountRate(baseInput({
      riskFreeRate: 4,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: false,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when election is not approved (draft/pending)', () => {
    const result = determineDiscountRate(baseInput({
      riskFreeRate: 4,
      riskFreeElectionApproved: false,
      entityEligibleForRiskFree: true,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when no risk-free rate is entered', () => {
    const result = determineDiscountRate(baseInput({
      riskFreeRate: null,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: true,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when implicit rate is not readily determinable even if provided', () => {
    const result = determineDiscountRate(baseInput({
      implicitRate: 5,
      implicitRateReadilyDeterminable: false,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when implicit rate is readily determinable but null', () => {
    const result = determineDiscountRate(baseInput({
      implicitRate: null,
      implicitRateReadilyDeterminable: true,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses IBR when implicit rate is zero', () => {
    const result = determineDiscountRate(baseInput({
      implicitRate: 0,
      implicitRateReadilyDeterminable: true,
    }));
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });
});

describe('getLeaseDiscountRate', () => {
  it('returns discount_rate when set', () => {
    const lease = { discount_rate: 4.5, incremental_borrowing_rate: 6 } as Lease;
    expect(getLeaseDiscountRate(lease)).toBe(4.5);
  });

  it('falls back to incremental_borrowing_rate when discount_rate is null', () => {
    const lease = { discount_rate: null, incremental_borrowing_rate: 6 } as unknown as Lease;
    expect(getLeaseDiscountRate(lease)).toBe(6);
  });

  it('falls back to incremental_borrowing_rate when discount_rate is undefined', () => {
    const lease = { incremental_borrowing_rate: 7 } as Lease;
    expect(getLeaseDiscountRate(lease)).toBe(7);
  });
});

describe('DISCOUNT_RATE_METHOD_LABELS', () => {
  it('has labels for all three methods', () => {
    expect(DISCOUNT_RATE_METHOD_LABELS.implicit).toBe('Rate Implicit in Lease');
    expect(DISCOUNT_RATE_METHOD_LABELS.risk_free).toBe('Risk-Free Rate');
    expect(DISCOUNT_RATE_METHOD_LABELS.ibr).toBe('Incremental Borrowing Rate');
  });
});

describe('Amortization and classification use the selected rate', () => {
  it('produces different PV for 6% IBR vs 4% risk-free', () => {
    const pv6 = calculatePresentValue(1000, 36, 6, 'beginning');
    const pv4 = calculatePresentValue(1000, 36, 4, 'beginning');
    expect(pv6).not.toEqual(pv4);
    expect(pv4).toBeGreaterThan(pv6);
  });

  it('calculateLeaseMetrics uses the passed-in rate, not a hardcoded one', () => {
    const metrics6 = calculateLeaseMetrics({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2024, 0, 1),
      paymentTiming: 'beginning',
      classification: 'operating',
    });
    const metrics4 = calculateLeaseMetrics({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 4,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2024, 0, 1),
      paymentTiming: 'beginning',
      classification: 'operating',
    });
    expect(metrics6.leaseLiability).not.toEqual(metrics4.leaseLiability);
    expect(metrics4.leaseLiability).toBeGreaterThan(metrics6.leaseLiability);
  });
});

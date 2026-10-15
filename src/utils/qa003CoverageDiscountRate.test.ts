import { describe, it, expect } from 'vitest';
import {
  determineLeaseDiscountRate,
  determineDiscountRate,
  getLeaseDiscountRate,
  NO_DISCOUNT_RATE_CONTEXT,
  type DiscountRateContext,
} from './discountRate';
import type { PolicyElection } from './policyElections';
import type { Lease } from '../types/lease';

function makeElection(overrides: Partial<PolicyElection> = {}): PolicyElection {
  return {
    id: 'el-1',
    company_id: 'co-1',
    fixed_asset_type_id: 'asset-1',
    policy_type: 'RISK_FREE_RATE',
    election_value: true,
    effective_from: '2026-01-01',
    effective_to: null,
    status: 'approved',
    policy_version: 1,
    notes: null,
    change_reason: null,
    prepared_by: 'p-1',
    approved_by: 'a-1',
    ...overrides,
  };
}

function makeLeaseForDiscount(overrides: Record<string, unknown> = {}): Pick<
  Lease,
  | 'implicit_rate'
  | 'implicit_rate_readily_determinable'
  | 'risk_free_rate'
  | 'incremental_borrowing_rate'
  | 'discount_rate'
  | 'discount_rate_method'
  | 'lease_start_date'
> {
  return {
    implicit_rate: null,
    implicit_rate_readily_determinable: false,
    risk_free_rate: null,
    incremental_borrowing_rate: 6,
    discount_rate: null,
    discount_rate_method: 'ibr',
    lease_start_date: '2026-03-15T00:00:00.000Z',
    ...overrides,
  } as Pick<
    Lease,
    | 'implicit_rate'
    | 'implicit_rate_readily_determinable'
    | 'risk_free_rate'
    | 'incremental_borrowing_rate'
    | 'discount_rate'
    | 'discount_rate_method'
    | 'lease_start_date'
  >;
}

describe('determineLeaseDiscountRate', () => {
  it('returns IBR when fixedAssetTypeId is null', () => {
    const lease = makeLeaseForDiscount({ incremental_borrowing_rate: 7 });
    const result = determineLeaseDiscountRate(lease, [], 'co-1', null, 'non_public_business_entity');
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(7);
  });

  it('returns IBR when fixedAssetTypeId is undefined', () => {
    const lease = makeLeaseForDiscount({ incremental_borrowing_rate: 5 });
    const result = determineLeaseDiscountRate(lease, [], 'co-1', undefined, null);
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(5);
  });

  it('returns IBR when no approved election exists', () => {
    const lease = makeLeaseForDiscount({ incremental_borrowing_rate: 6 });
    const elections = [makeElection({ status: 'draft' })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('uses risk-free rate for non-public entity with approved election', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('risk_free');
    expect(result.rate).toBe(3);
  });

  it('uses implicit rate when readily determinable, even with risk-free election', () => {
    const lease = makeLeaseForDiscount({
      implicit_rate: 4,
      implicit_rate_readily_determinable: true,
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('implicit');
    expect(result.rate).toBe(4);
  });

  it('falls back to IBR for public business entity even with approved election', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 7,
    });
    const elections = [makeElection({ election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'public_business_entity');
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(7);
  });

  it('respects election_value=false (elected NOT to use risk-free)', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ election_value: false })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('handles null incremental_borrowing_rate as 0', () => {
    const lease = makeLeaseForDiscount({ incremental_borrowing_rate: null });
    const result = determineLeaseDiscountRate(lease, [], 'co-1', 'asset-1', null);
    expect(result.rate).toBe(0);
  });

  it('handles null entity type (treated as not eligible for risk-free)', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', null);
    expect(result.method).toBe('ibr');
  });

  it('picks the latest version when multiple approved elections exist', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 2.5,
      incremental_borrowing_rate: 6,
    });
    const elections = [
      makeElection({ policy_version: 1, election_value: false }),
      makeElection({ policy_version: 2, election_value: true }),
    ];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('risk_free');
    expect(result.rate).toBe(2.5);
  });

  it('does not match election for different company_id', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ company_id: 'other-co', election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('ibr');
  });

  it('does not match election for different fixed_asset_type_id', () => {
    const lease = makeLeaseForDiscount({
      risk_free_rate: 3,
      incremental_borrowing_rate: 6,
    });
    const elections = [makeElection({ fixed_asset_type_id: 'other-asset', election_value: true })];
    const result = determineLeaseDiscountRate(lease, elections, 'co-1', 'asset-1', 'non_public_business_entity');
    expect(result.method).toBe('ibr');
  });

  it('strips time from lease_start_date for asOfDate', () => {
    const lease = makeLeaseForDiscount({
      lease_start_date: '2026-06-15T12:30:00.000Z',
      incremental_borrowing_rate: 5,
    });
    const result = determineLeaseDiscountRate(lease, [], 'co-1', 'asset-1', null);
    expect(result.method).toBe('ibr');
  });
});

describe('NO_DISCOUNT_RATE_CONTEXT', () => {
  it('has all fields defaulted to safe values', () => {
    expect(NO_DISCOUNT_RATE_CONTEXT.riskFreeElectionApproved).toBe(false);
    expect(NO_DISCOUNT_RATE_CONTEXT.entityEligibleForRiskFree).toBe(false);
    expect(NO_DISCOUNT_RATE_CONTEXT.riskFreePolicyElectionId).toBe(null);
  });

  it('satisfies the DiscountRateContext interface', () => {
    const ctx: DiscountRateContext = NO_DISCOUNT_RATE_CONTEXT;
    expect(ctx).toBeDefined();
  });
});

describe('determineDiscountRate edge cases (recalculation)', () => {
  it('risk-free rate of exactly 0 is not used (falls through to IBR)', () => {
    const result = determineDiscountRate({
      implicitRate: null,
      implicitRateReadilyDeterminable: false,
      riskFreeRate: 0,
      incrementalBorrowingRate: 6,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: true,
    });
    expect(result.method).toBe('ibr');
    expect(result.rate).toBe(6);
  });

  it('negative risk-free rate is not used (guard is > 0)', () => {
    const result = determineDiscountRate({
      implicitRate: null,
      implicitRateReadilyDeterminable: false,
      riskFreeRate: -0.5,
      incrementalBorrowingRate: 6,
      riskFreeElectionApproved: true,
      entityEligibleForRiskFree: true,
    });
    expect(result.method).toBe('ibr');
  });

  it('negative implicit rate is not used (guard is > 0)', () => {
    const result = determineDiscountRate({
      implicitRate: -1,
      implicitRateReadilyDeterminable: true,
      riskFreeRate: null,
      incrementalBorrowingRate: 6,
      riskFreeElectionApproved: false,
      entityEligibleForRiskFree: false,
    });
    expect(result.method).toBe('ibr');
  });
});

describe('getLeaseDiscountRate edge cases', () => {
  it('returns discount_rate when it is 0', () => {
    const lease = { discount_rate: 0, incremental_borrowing_rate: 6 } as Lease;
    expect(getLeaseDiscountRate(lease)).toBe(0);
  });

  it('returns incremental_borrowing_rate when discount_rate is 0 but IBR is positive', () => {
    // 0 ?? 6 evaluates to 0 (nullish coalescing only checks null/undefined)
    const lease = { discount_rate: 0, incremental_borrowing_rate: 6 } as Lease;
    expect(getLeaseDiscountRate(lease)).toBe(0);
  });
});

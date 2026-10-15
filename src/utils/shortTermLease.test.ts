import { describe, it, expect } from 'vitest';
import { qualifiesForShortTermExemption, computeShortTermLeaseCost, type ShortTermQualificationInput } from './shortTermLease';
import type { PolicyElection } from './policyElections';

function makeElection(overrides: Partial<PolicyElection> = {}): PolicyElection {
  return {
    id: 'stl-election-1',
    company_id: 'comp-1',
    fixed_asset_type_id: 'asset-type-1',
    policy_type: 'SHORT_TERM_LEASE',
    election_value: true,
    effective_from: '2026-01-01',
    effective_to: null,
    status: 'approved',
    policy_version: 1,
    notes: null,
    change_reason: null,
    prepared_by: null,
    approved_by: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ShortTermQualificationInput> = {}): ShortTermQualificationInput {
  return {
    leaseTermMonths: 10,
    purchaseOption: false,
    purchaseOptionReasonablyCertain: false,
    companyId: 'comp-1',
    fixedAssetTypeId: 'asset-type-1',
    leaseStartDate: '2026-01-01',
    shortTermElections: [makeElection()],
    ...overrides,
  };
}

describe('qualifiesForShortTermExemption', () => {
  it('10-month lease, election approved, no purchase option → exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput());
    expect(result.applied).toBe(true);
    expect(result.policyElectionId).toBe('stl-election-1');
  });

  it('same lease with election OFF → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({
      shortTermElections: [makeElection({ election_value: false })],
    }));
    expect(result.applied).toBe(false);
  });

  it('24-month lease with election ON → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({ leaseTermMonths: 24 }));
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('exceeds 12');
  });

  it('12 months qualifies', () => {
    const result = qualifiesForShortTermExemption(baseInput({ leaseTermMonths: 12 }));
    expect(result.applied).toBe(true);
  });

  it('13 months does not qualify', () => {
    const result = qualifiesForShortTermExemption(baseInput({ leaseTermMonths: 13 }));
    expect(result.applied).toBe(false);
  });

  it('purchase option → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({ purchaseOption: true, purchaseOptionReasonablyCertain: true }));
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('purchase option');
  });

  it('election draft/pending → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({
      shortTermElections: [makeElection({ status: 'pending_approval' })],
    }));
    expect(result.applied).toBe(false);
  });

  it('election effective after commencement → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({
      leaseStartDate: '2026-01-01',
      shortTermElections: [makeElection({ effective_from: '2026-06-01' })],
    }));
    expect(result.applied).toBe(false);
  });

  it('no asset class → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({ fixedAssetTypeId: null }));
    expect(result.applied).toBe(false);
  });

  it('zero term → not exempt', () => {
    const result = qualifiesForShortTermExemption(baseInput({ leaseTermMonths: 0 }));
    expect(result.applied).toBe(false);
  });
});

describe('computeShortTermLeaseCost', () => {
  it('straight-line cost = total payments / term', () => {
    expect(computeShortTermLeaseCost(10000, 10)).toBe(1000);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeShortTermLeaseCost(10000, 3)).toBe(3333.33);
  });

  it('returns 0 for zero term', () => {
    expect(computeShortTermLeaseCost(10000, 0)).toBe(0);
  });
});

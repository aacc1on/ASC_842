import { describe, it, expect } from 'vitest';
import {
  getApplicablePolicy,
  getPolicyCoverage,
  generateDisclosureNarrative,
  isRiskFreeRateEligible,
  isFullyConfigured,
  ASC_POLICY_REFERENCES,
  type PolicyElection,
  type AssetTypeInfo,
  type PolicyType,
} from './policyElections';

const mockElections: PolicyElection[] = [
  {
    id: '1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
    election_value: true, effective_from: '2024-01-01', effective_to: null,
    status: 'approved', policy_version: 1, notes: null, change_reason: null,
    prepared_by: 'u1', approved_by: 'u2',
  },
  {
    id: '2', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'COMBINE_LEASE_NONLEASE',
    election_value: false, effective_from: '2024-01-01', effective_to: null,
    status: 'approved', policy_version: 1, notes: null, change_reason: null,
    prepared_by: 'u1', approved_by: 'u2',
  },
  {
    id: '3', company_id: 'c1', fixed_asset_type_id: 'a2', policy_type: 'SHORT_TERM_LEASE',
    election_value: true, effective_from: '2024-01-01', effective_to: null,
    status: 'pending_approval', policy_version: 1, notes: null, change_reason: null,
    prepared_by: 'u1', approved_by: null,
  },
  {
    id: '4', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'RISK_FREE_RATE',
    election_value: true, effective_from: '2024-01-01', effective_to: null,
    status: 'approved', policy_version: 1, notes: null, change_reason: null,
    prepared_by: 'u1', approved_by: 'u2',
  },
];

const mockAssetTypes: AssetTypeInfo[] = [
  { id: 'a1', type_name: 'Real Estate', is_active: true },
  { id: 'a2', type_name: 'Vehicles', is_active: true },
  { id: 'a3', type_name: 'Equipment', is_active: false },
];

describe('ASC_POLICY_REFERENCES', () => {
  it('has references for all three policy types', () => {
    expect(ASC_POLICY_REFERENCES.SHORT_TERM_LEASE).toBe('842-20-50-8');
    expect(ASC_POLICY_REFERENCES.COMBINE_LEASE_NONLEASE).toBe('842-20-50-9');
    expect(ASC_POLICY_REFERENCES.RISK_FREE_RATE).toBe('842-20-50-10');
  });
});

describe('getApplicablePolicy', () => {
  it('returns the approved election effective on the given date', () => {
    const result = getApplicablePolicy(mockElections, 'c1', 'a1', 'SHORT_TERM_LEASE', '2024-06-01');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
    expect(result!.election_value).toBe(true);
  });

  it('returns null when no approved election exists', () => {
    const result = getApplicablePolicy(mockElections, 'c1', 'a2', 'SHORT_TERM_LEASE', '2024-06-01');
    expect(result).toBeNull();
  });

  it('returns null for a different company', () => {
    const result = getApplicablePolicy(mockElections, 'c2', 'a1', 'SHORT_TERM_LEASE', '2024-06-01');
    expect(result).toBeNull();
  });

  it('respects effective_from date boundary', () => {
    const result = getApplicablePolicy(mockElections, 'c1', 'a1', 'SHORT_TERM_LEASE', '2023-12-31');
    expect(result).toBeNull();
  });

  it('respects effective_to date boundary', () => {
    const electionsWithEnd: PolicyElection[] = [
      {
        ...mockElections[0], effective_to: '2024-03-31',
      },
    ];
    const result = getApplicablePolicy(electionsWithEnd, 'c1', 'a1', 'SHORT_TERM_LEASE', '2024-06-01');
    expect(result).toBeNull();
  });

  it('returns the highest version when multiple approved versions exist', () => {
    const multi: PolicyElection[] = [
      ...mockElections,
      {
        id: '5', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
        election_value: false, effective_from: '2024-06-01', effective_to: null,
        status: 'approved', policy_version: 2, notes: null, change_reason: 'Policy change',
        prepared_by: 'u1', approved_by: 'u2',
      },
    ];
    const result = getApplicablePolicy(multi, 'c1', 'a1', 'SHORT_TERM_LEASE', '2024-07-01');
    expect(result).not.toBeNull();
    expect(result!.policy_version).toBe(2);
    expect(result!.election_value).toBe(false);
  });
});

describe('isRiskFreeRateEligible', () => {
  it('returns false for public_business_entity', () => {
    expect(isRiskFreeRateEligible('public_business_entity')).toBe(false);
  });
  it('returns false for null', () => {
    expect(isRiskFreeRateEligible(null)).toBe(false);
  });
  it('returns true for non_public_business_entity', () => {
    expect(isRiskFreeRateEligible('non_public_business_entity')).toBe(true);
  });
  it('returns true for not_for_profit_other', () => {
    expect(isRiskFreeRateEligible('not_for_profit_other')).toBe(true);
  });
});

describe('getPolicyCoverage', () => {
  it('returns elected for approved elections', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const stlA1 = coverage.find((c) => c.assetTypeId === 'a1' && c.policyType === 'SHORT_TERM_LEASE');
    expect(stlA1).toBeDefined();
    expect(stlA1!.result).toBe('elected');
    expect(stlA1!.electionValue).toBe(true);
  });

  it('returns not_elected when approved with election_value false', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const combineA1 = coverage.find((c) => c.assetTypeId === 'a1' && c.policyType === 'COMBINE_LEASE_NONLEASE');
    expect(combineA1).toBeDefined();
    expect(combineA1!.result).toBe('elected');
    expect(combineA1!.electionValue).toBe(false);
  });

  it('returns pending for pending_approval status', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const stlA2 = coverage.find((c) => c.assetTypeId === 'a2' && c.policyType === 'SHORT_TERM_LEASE');
    expect(stlA2).toBeDefined();
    expect(stlA2!.result).toBe('pending');
  });

  it('returns not_configured when no election exists', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const combineA2 = coverage.find((c) => c.assetTypeId === 'a2' && c.policyType === 'COMBINE_LEASE_NONLEASE');
    expect(combineA2).toBeDefined();
    expect(combineA2!.result).toBe('not_configured');
  });

  it('returns not_eligible for risk-free rate when entity is public business entity', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'public_business_entity');
    const rfrA1 = coverage.find((c) => c.assetTypeId === 'a1' && c.policyType === 'RISK_FREE_RATE');
    expect(rfrA1).toBeDefined();
    expect(rfrA1!.result).toBe('not_eligible');
  });

  it('skips inactive asset types', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    expect(coverage.find((c) => c.assetTypeId === 'a3')).toBeUndefined();
  });
});

describe('isFullyConfigured', () => {
  it('returns true when all are elected or not_eligible', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    // a1 has all 3 approved, a2 is pending for some → not fully configured
    expect(isFullyConfigured(coverage)).toBe(false);
  });

  it('returns true for fully configured coverage', () => {
    const fullElections: PolicyElection[] = mockAssetTypes.filter((a) => a.is_active).flatMap((a) =>
      (['SHORT_TERM_LEASE', 'COMBINE_LEASE_NONLEASE', 'RISK_FREE_RATE'] as PolicyType[]).map((pt) => ({
        id: `${a.id}-${pt}`, company_id: 'c1', fixed_asset_type_id: a.id, policy_type: pt,
        election_value: true, effective_from: '2024-01-01', effective_to: null,
        status: 'approved' as const, policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: 'u2',
      }))
    );
    const coverage = getPolicyCoverage(mockAssetTypes, fullElections, '2024-06-01', 'c1', 'non_public_business_entity');
    expect(isFullyConfigured(coverage)).toBe(true);
  });
});

describe('generateDisclosureNarrative', () => {
  it('produces three paragraphs', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const narrative = generateDisclosureNarrative(coverage, 'non_public_business_entity');
    expect(narrative).toHaveLength(3);
    expect(narrative[0]).toContain('short-term lease');
    expect(narrative[1]).toContain('lease and nonlease components');
    expect(narrative[2]).toContain('risk-free rate');
  });

  it('includes asset class names from data, not hard-coded', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const narrative = generateDisclosureNarrative(coverage, 'non_public_business_entity');
    expect(narrative[0]).toContain('Real Estate');
  });

  it('mentions ineligibility for public business entity risk-free rate', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'public_business_entity');
    const narrative = generateDisclosureNarrative(coverage, 'public_business_entity');
    expect(narrative[2]).toContain('not eligible');
  });

  it('mentions not configured for missing elections', () => {
    const coverage = getPolicyCoverage(mockAssetTypes, mockElections, '2024-06-01', 'c1', 'non_public_business_entity');
    const narrative = generateDisclosureNarrative(coverage, 'non_public_business_entity');
    expect(narrative[0]).toContain('not been configured');
  });
});

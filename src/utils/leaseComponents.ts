import { getApplicablePolicy, type PolicyElection } from './policyElections';

export type ComponentPolicy = 'combined' | 'separate' | 'not_applicable';

export interface ComponentPolicyInput {
  nonleaseAmount: number;
  companyId: string;
  fixedAssetTypeId: string | null | undefined;
  leaseStartDate: string;
  elections: PolicyElection[];
}

export interface ComponentPolicyResult {
  policy: ComponentPolicy;
  policyElectionId: string | null;
  reason: string;
  warning: string | null;
}

/**
 * ASC 842-10-15-37 practical expedient: combine lease and nonlease components.
 *
 * - nonleaseAmount = 0 → 'not_applicable'
 * - approved COMBINE_LEASE_NONLEASE election effective at lease start with
 *   election_value true → 'combined'
 * - approved election with election_value false → 'separate'
 * - no approved election → 'separate' (ASC 842 default) + warning
 */
export function determineComponentPolicy(
  input: ComponentPolicyInput
): ComponentPolicyResult {
  const { nonleaseAmount, companyId, fixedAssetTypeId, leaseStartDate, elections } = input;

  if (nonleaseAmount <= 0) {
    return {
      policy: 'not_applicable',
      policyElectionId: null,
      reason: 'No nonlease component — component policy not applicable',
      warning: null,
    };
  }

  if (!fixedAssetTypeId) {
    return {
      policy: 'separate',
      policyElectionId: null,
      reason: 'No asset class assigned — defaulting to separate',
      warning: 'No approved lease/nonlease component election for this asset class. Components are accounted for separately.',
    };
  }

  const asOfDate = leaseStartDate.split('T')[0];
  const policy = getApplicablePolicy(
    elections,
    companyId,
    fixedAssetTypeId,
    'COMBINE_LEASE_NONLEASE',
    asOfDate,
  );

  if (!policy) {
    return {
      policy: 'separate',
      policyElectionId: null,
      reason: 'No approved COMBINE_LEASE_NONLEASE election effective at lease start',
      warning: 'No approved lease/nonlease component election for this asset class. Components are accounted for separately.',
    };
  }

  if (policy.election_value) {
    return {
      policy: 'combined',
      policyElectionId: policy.id,
      reason: `Lease/nonlease practical expedient applied (election approved v${policy.policy_version})`,
      warning: null,
    };
  }

  return {
    policy: 'separate',
    policyElectionId: policy.id,
    reason: `Components accounted for separately (election approved, not elected v${policy.policy_version})`,
    warning: null,
  };
}

/**
 * The payment amount used for ASC 842 measurement.
 * When combined, the nonlease amount is included in the lease payment.
 * When separate or not_applicable, only the lease component is used.
 */
export function measurementPaymentPerPeriod(
  leaseComponent: number,
  nonleaseComponent: number,
  policy: ComponentPolicy
): number {
  if (policy === 'combined') {
    return round2(leaseComponent + nonleaseComponent);
  }
  return round2(leaseComponent);
}

/**
 * Allocate a total consideration between lease and nonlease components by
 * relative standalone selling price. The remainder goes to the lease component
 * so the two amounts sum exactly to the total.
 */
export function allocateByStandalonePrice(
  totalConsideration: number,
  leaseStandalonePrice: number,
  nonleaseStandalonePrice: number
): { leaseComponent: number; nonleaseComponent: number } {
  const totalStandalone = leaseStandalonePrice + nonleaseStandalonePrice;
  if (totalStandalone <= 0) {
    return { leaseComponent: round2(totalConsideration), nonleaseComponent: 0 };
  }

  const nonleaseRaw = (nonleaseStandalonePrice / totalStandalone) * totalConsideration;
  const nonleaseComponent = round2(nonleaseRaw);
  const leaseComponent = round2(totalConsideration - nonleaseComponent);

  return { leaseComponent, nonleaseComponent };
}

function round2(value: number): number {
  if (!isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

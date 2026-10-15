import { getApplicablePolicy, type PolicyElection } from './policyElections';

export interface ShortTermQualificationInput {
  leaseTermMonths: number;
  purchaseOption: boolean;
  purchaseOptionReasonablyCertain: boolean;
  companyId: string;
  fixedAssetTypeId: string | null | undefined;
  leaseStartDate: string;
  shortTermElections: PolicyElection[];
}

export interface ShortTermQualificationResult {
  applied: boolean;
  reason: string;
  policyElectionId: string | null;
}

export const MAX_SHORT_TERM_MONTHS = 12;

/**
 * ASC 842-20-25-2 short-term lease recognition exemption (lessee).
 *
 * A lease qualifies when:
 * 1. lease_term_months <= 12 at commencement, AND
 * 2. the lessee does NOT have a purchase option it is reasonably certain to exercise
 *    (purchase_option = true means reasonably certain → disqualifies).
 *
 * The exemption is APPLIED only when:
 * 3. the SHORT_TERM_LEASE election for the lease's company and fixed asset type
 *    is approved, election_value true, and effective at lease_start_date.
 *
 * Otherwise the lease is recognized normally.
 */
export function qualifiesForShortTermExemption(
  input: ShortTermQualificationInput
): ShortTermQualificationResult {
  const { leaseTermMonths, purchaseOptionReasonablyCertain, companyId, fixedAssetTypeId, leaseStartDate, shortTermElections } = input;

  if (leaseTermMonths > MAX_SHORT_TERM_MONTHS) {
    return {
      applied: false,
      reason: `Lease term ${leaseTermMonths} months exceeds ${MAX_SHORT_TERM_MONTHS} months`,
      policyElectionId: null,
    };
  }

  if (leaseTermMonths <= 0) {
    return {
      applied: false,
      reason: 'Lease term must be greater than zero',
      policyElectionId: null,
    };
  }

  if (purchaseOptionReasonablyCertain) {
    return {
      applied: false,
      reason: 'Lessee has a purchase option reasonably certain to be exercised',
      policyElectionId: null,
    };
  }

  if (!fixedAssetTypeId) {
    return {
      applied: false,
      reason: 'No asset class assigned',
      policyElectionId: null,
    };
  }

  const asOfDate = leaseStartDate.split('T')[0];
  const policy = getApplicablePolicy(
    shortTermElections,
    companyId,
    fixedAssetTypeId,
    'SHORT_TERM_LEASE',
    asOfDate,
  );

  if (!policy) {
    return {
      applied: false,
      reason: 'Short-term lease election not approved or not effective at commencement',
      policyElectionId: null,
    };
  }

  if (!policy.election_value) {
    return {
      applied: false,
      reason: 'Short-term lease election approved but not elected (election_value = false)',
      policyElectionId: null,
    };
  }

  return {
    applied: true,
    reason: `Short-term lease exemption applied (term ${leaseTermMonths} mo, no purchase option reasonably certain, election approved v${policy.policy_version})`,
    policyElectionId: policy.id,
  };
}

/**
 * Computes the straight-line monthly lease cost for a short-term exempt lease.
 * Total lease payments / lease term months.
 * For variable payments, each period's cost is that period's actual payment.
 */
export function computeShortTermLeaseCost(
  totalPayments: number,
  leaseTermMonths: number,
): number {
  if (leaseTermMonths <= 0) return 0;
  return Math.round(((totalPayments / leaseTermMonths) + Number.EPSILON) * 100) / 100;
}

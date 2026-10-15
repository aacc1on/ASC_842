import type { Lease } from '../types/lease';
import {
  getApplicablePolicy,
  isRiskFreeRateEligible,
  type PolicyElection,
  type EntityType,
  type PolicyType,
} from './policyElections';

export type DiscountRateMethod = 'implicit' | 'risk_free' | 'ibr';

export interface DetermineDiscountRateInput {
  implicitRate: number | null;
  implicitRateReadilyDeterminable: boolean;
  riskFreeRate: number | null;
  incrementalBorrowingRate: number;
  riskFreeElectionApproved: boolean;
  entityEligibleForRiskFree: boolean;
}

export interface DetermineDiscountRateResult {
  method: DiscountRateMethod;
  rate: number;
  reason: string;
}

/**
 * ASC 842 discount rate hierarchy:
 * 1. If the rate implicit in the lease is readily determinable and provided, use it.
 *    Never override it with a risk-free rate.
 * 2. Otherwise, if the risk-free election is approved and effective for the lease's
 *    company and fixed asset type at the lease commencement date AND the company
 *    entity_type is not public_business_entity AND a risk-free rate is provided, use it.
 * 3. Otherwise, use the incremental borrowing rate.
 */
export function determineDiscountRate(
  input: DetermineDiscountRateInput
): DetermineDiscountRateResult {
  // 1. Implicit rate — highest priority
  if (
    input.implicitRateReadilyDeterminable &&
    input.implicitRate != null &&
    input.implicitRate > 0
  ) {
    return {
      method: 'implicit',
      rate: input.implicitRate,
      reason: 'Rate implicit in the lease is readily determinable',
    };
  }

  // 2. Risk-free rate — second priority
  if (
    input.riskFreeElectionApproved &&
    input.entityEligibleForRiskFree &&
    input.riskFreeRate != null &&
    input.riskFreeRate > 0
  ) {
    return {
      method: 'risk_free',
      rate: input.riskFreeRate,
      reason: 'Risk-free rate elected per ASC 842 accounting policy election',
    };
  }

  // 3. Incremental borrowing rate — fallback
  return {
    method: 'ibr',
    rate: input.incrementalBorrowingRate,
    reason: 'Incremental borrowing rate',
  };
}

/**
 * Returns the stored discount rate for a lease, falling back to
 * incremental_borrowing_rate when discount_rate is null.
 */
export function getLeaseDiscountRate(lease: Lease): number {
  return lease.discount_rate ?? lease.incremental_borrowing_rate;
}

/**
 * High-level helper that determines the discount rate for a lease given
 * its policy elections and company context. Uses getApplicablePolicy
 * with asOfDate = lease_start_date.
 */
export function determineLeaseDiscountRate(
  lease: Pick<
    Lease,
    | 'implicit_rate'
    | 'implicit_rate_readily_determinable'
    | 'risk_free_rate'
    | 'incremental_borrowing_rate'
    | 'discount_rate'
    | 'discount_rate_method'
    | 'lease_start_date'
  >,
  elections: PolicyElection[],
  companyId: string,
  fixedAssetTypeId: string | null | undefined,
  entityType: EntityType | null,
): DetermineDiscountRateResult {
  const asOfDate = lease.lease_start_date.split('T')[0];
  const ibr = lease.incremental_borrowing_rate ?? 0;

  if (!fixedAssetTypeId) {
    return { method: 'ibr', rate: ibr, reason: 'Incremental borrowing rate' };
  }

  const rfrPolicy = getApplicablePolicy(
    elections,
    companyId,
    fixedAssetTypeId,
    'RISK_FREE_RATE' as PolicyType,
    asOfDate,
  );

  const riskFreeElectionApproved =
    rfrPolicy != null && rfrPolicy.election_value === true;

  return determineDiscountRate({
    implicitRate: lease.implicit_rate ?? null,
    implicitRateReadilyDeterminable: lease.implicit_rate_readily_determinable ?? false,
    riskFreeRate: lease.risk_free_rate ?? null,
    incrementalBorrowingRate: ibr,
    riskFreeElectionApproved,
    entityEligibleForRiskFree: isRiskFreeRateEligible(entityType),
  });
}

export const DISCOUNT_RATE_METHOD_LABELS: Record<DiscountRateMethod, string> = {
  implicit: 'Rate Implicit in Lease',
  risk_free: 'Risk-Free Rate',
  ibr: 'Incremental Borrowing Rate',
};

/**
 * Context that determines whether the risk-free rate election is available
 * for a given lease form. Computed once per form render and threaded through
 * every calculation so the same rate is used everywhere.
 */
export interface DiscountRateContext {
  riskFreeElectionApproved: boolean;
  entityEligibleForRiskFree: boolean;
  riskFreePolicyElectionId: string | null;
}

export const NO_DISCOUNT_RATE_CONTEXT: DiscountRateContext = {
  riskFreeElectionApproved: false,
  entityEligibleForRiskFree: false,
  riskFreePolicyElectionId: null,
};

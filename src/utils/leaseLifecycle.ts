import type { Lease } from '../types/lease';
import { toYMD } from './formatting';

export type LeaseLifecycle = 'active' | 'not_started' | 'ended';
export type LeaseStatusFilter = LeaseLifecycle | 'all';

type LifecycleInput = Pick<Lease, 'status' | 'lease_start_date' | 'lease_end_date'>;

export function todayYmd(): string {
  return toYMD(new Date());
}

export function leaseLifecycle(lease: LifecycleInput, asOf: string = todayYmd()): LeaseLifecycle {
  if (lease.status !== 'active' || lease.lease_end_date < asOf) return 'ended';
  if (lease.lease_start_date > asOf) return 'not_started';
  return 'active';
}

export function isActiveLease(lease: LifecycleInput, asOf?: string): boolean {
  return leaseLifecycle(lease, asOf) === 'active';
}

export const LIFECYCLE_LABEL: Record<LeaseLifecycle, string> = {
  active: 'Active',
  not_started: 'Not started',
  ended: 'Ended',
};

export const LIFECYCLE_BADGE: Record<LeaseLifecycle, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  not_started: 'bg-sky-100 text-sky-700',
  ended: 'bg-slate-100 text-slate-600',
};

// Mirrors the p_missing_classification rule in get_lease_portfolio_totals.
export function isMissingClassificationData(
  lease: Pick<Lease, 'lease_classification' | 'accounting_treatment' | 'asset_market_value' | 'asset_economic_life_months'>,
): boolean {
  if (lease.lease_classification !== 'finance' || lease.accounting_treatment === 'short_term_exemption') return false;
  return !(Number(lease.asset_market_value) > 0) || !(Number(lease.asset_economic_life_months) > 0);
}

export const MISSING_CLASSIFICATION_OR_FILTER =
  'asset_market_value.is.null,asset_market_value.lte.0,asset_economic_life_months.is.null,asset_economic_life_months.lte.0';

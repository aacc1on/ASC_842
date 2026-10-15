import type { Lease } from '../types/lease';
import { buildPaymentStream, getPaymentForPeriod, monthsPerPayment, round2, type PaymentFrequency, type PaymentTranche } from './leaseCalculations';
import { leaseLifecycle, todayYmd } from './leaseLifecycle';
import { parseLocalDate } from './formatting';

export type DashboardLeaseType = 'finance' | 'operating';
export type DashboardStatusFilter = 'active' | 'expired' | 'all';

export interface LeaseDashboardFilters {
  branchId: string;
  type: 'all' | DashboardLeaseType;
  status: DashboardStatusFilter;
}

export const DEFAULT_DASHBOARD_FILTERS: LeaseDashboardFilters = { branchId: 'all', type: 'all', status: 'active' };

export interface LeaseDashboardRow {
  lease: Lease;
  id: string;
  name: string;
  branchName: string;
  type: DashboardLeaseType;
  expired: boolean;
  startDate: string;
  endDate: string;
  termMonths: number;
  monthsRemaining: number;
  paymentFrequency: PaymentFrequency;
  /** Lease-only payment for the current period, as a monthly amount (quarterly etc. spread per month). */
  monthlyLease: number;
  monthlyNonlease: number | null;
  totalLease: number;
  totalNonlease: number | null;
}

export interface LeaseDashboardTotals {
  count: number;
  monthlyLease: number;
  monthlyNonlease: number;
  totalLease: number;
  totalNonlease: number;
}

export type DashboardSortKey =
  | 'name' | 'branchName' | 'startDate' | 'endDate' | 'termMonths' | 'monthsRemaining'
  | 'monthlyLease' | 'monthlyNonlease' | 'totalLease' | 'totalNonlease';

const FREQUENCIES: PaymentFrequency[] = ['monthly', 'quarterly', 'semi_annually', 'annually', 'weekly'];

function toFrequency(value: string): PaymentFrequency {
  return (FREQUENCIES as string[]).includes(value) ? (value as PaymentFrequency) : 'monthly';
}

/** Whole months elapsed from the start date to `asOf` (0 during the first month). */
function monthsElapsed(startYmd: string, asOfYmd: string): number {
  const s = parseLocalDate(startYmd);
  const a = parseLocalDate(asOfYmd);
  const diff = (a.getFullYear() - s.getFullYear()) * 12 + (a.getMonth() - s.getMonth());
  return a.getDate() < s.getDate() ? diff - 1 : diff;
}

/*
 * Stored payment_amount and schedule tranches are the measurement payment, which already includes the
 * non-lease component when the policy is "combined"; strip it out so the lease columns show lease only.
 */
export function buildDashboardRow(
  lease: Lease,
  tranches: PaymentTranche[],
  branchName: string,
  asOf: string = todayYmd(),
): LeaseDashboardRow {
  const term = Math.max(0, Number(lease.lease_term_months) || 0);
  const frequency = toFrequency(lease.payment_frequency);
  const nonlease = Math.max(0, Number(lease.nonlease_component_amount) || 0);
  const combined = lease.component_policy === 'combined' && nonlease > 0;
  const strip = (amount: number) => round2(combined ? amount - nonlease : amount);

  const leasePayment = strip(Number(lease.payment_amount) || 0);
  const leaseTranches = tranches.map((t) => ({ ...t, paymentAmount: strip(t.paymentAmount) }));

  const lifecycle = leaseLifecycle(lease, asOf);
  const elapsed = lifecycle === 'not_started' ? 0 : lifecycle === 'ended' ? term : Math.max(0, monthsElapsed(lease.lease_start_date, asOf));
  const monthsRemaining = Math.min(term, Math.max(0, term - elapsed));
  const currentPeriod = Math.min(Math.max(1, elapsed + 1), Math.max(1, term));

  const totalLease = round2(
    buildPaymentStream(term, leasePayment, leaseTranches, frequency, lease.payment_timing).reduce((s, p) => s + p, 0),
  );
  const totalNonlease = nonlease > 0
    ? round2(combined
      ? buildPaymentStream(term, nonlease, undefined, frequency, lease.payment_timing).reduce((s, p) => s + p, 0)
      : nonlease * term)
    : null;

  return {
    lease,
    id: lease.id,
    name: lease.lease_name,
    branchName,
    type: lease.lease_classification === 'finance' ? 'finance' : 'operating',
    expired: lifecycle === 'ended',
    startDate: lease.lease_start_date,
    endDate: lease.lease_end_date,
    termMonths: term,
    monthsRemaining,
    paymentFrequency: frequency,
    monthlyLease: frequency === 'weekly'
      ? getPaymentForPeriod(currentPeriod, leasePayment, leaseTranches, 'weekly')
      : round2(getPaymentForPeriod(currentPeriod, leasePayment, leaseTranches, 'monthly') / monthsPerPayment(frequency)),
    monthlyNonlease: nonlease > 0 ? nonlease : null,
    totalLease,
    totalNonlease,
  };
}

export function filterDashboardRows(rows: LeaseDashboardRow[], filters: LeaseDashboardFilters, asOf: string = todayYmd()): LeaseDashboardRow[] {
  return rows.filter((r) => {
    if (filters.type !== 'all' && r.type !== filters.type) return false;
    if (filters.branchId === 'none' ? !!r.lease.branch_id : filters.branchId !== 'all' && r.lease.branch_id !== filters.branchId) return false;
    if (filters.status === 'active') return leaseLifecycle(r.lease, asOf) === 'active';
    if (filters.status === 'expired') return r.expired;
    return true;
  });
}

export function sortDashboardRows(rows: LeaseDashboardRow[], key: DashboardSortKey, dir: 'asc' | 'desc'): LeaseDashboardRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return a.name.localeCompare(b.name);
    if (av === null) return 1;
    if (bv === null) return -1;
    const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return c * sign;
  });
}

export function totalDashboardRows(rows: LeaseDashboardRow[]): LeaseDashboardTotals {
  const t = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      monthlyLease: acc.monthlyLease + r.monthlyLease,
      monthlyNonlease: acc.monthlyNonlease + (r.monthlyNonlease ?? 0),
      totalLease: acc.totalLease + r.totalLease,
      totalNonlease: acc.totalNonlease + (r.totalNonlease ?? 0),
    }),
    { count: 0, monthlyLease: 0, monthlyNonlease: 0, totalLease: 0, totalNonlease: 0 },
  );
  return {
    count: t.count,
    monthlyLease: round2(t.monthlyLease),
    monthlyNonlease: round2(t.monthlyNonlease),
    totalLease: round2(t.totalLease),
    totalNonlease: round2(t.totalNonlease),
  };
}

export interface DashboardGroup {
  type: DashboardLeaseType;
  label: string;
  rows: LeaseDashboardRow[];
  totals: LeaseDashboardTotals;
}

export function groupDashboardRows(rows: LeaseDashboardRow[]): DashboardGroup[] {
  return (['finance', 'operating'] as const).map((type) => {
    const groupRows = rows.filter((r) => r.type === type);
    return {
      type,
      label: type === 'finance' ? 'Finance leases' : 'Operating leases',
      rows: groupRows,
      totals: totalDashboardRows(groupRows),
    };
  });
}

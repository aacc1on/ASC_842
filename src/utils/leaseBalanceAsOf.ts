import { supabase } from '../lib/supabase';
import { currentOrgId } from './currentOrg';

/*
 * The "balance as of date" rule lives only in the database:
 * public.get_lease_balances_as_of -> internal.lease_balance_as_of.
 *
 * Convention:
 * - Balances come only from the amortization schedule, never the stored lease totals.
 * - A period (period_date = 1st of month) is completed when the last day of its month <= asOf.
 * - ROU amortization and interest are recognised through the last completed period end
 *   (no partial-month accrual).
 * - A payment reduces the liability on its payment date: beginning timing = 1st day of the
 *   period, end timing = last day of the period.
 * - asOf before commencement -> 'not_started' (0 / 0, excluded from totals).
 * - asOf on/after lease end, or after the last schedule period -> 'ended' (0 / 0).
 * - Current portion = liability(asOf) - liability(asOf + 12 months).
 */

export type LeaseBalanceStatus = 'not_started' | 'active' | 'ended' | 'no_schedule';

export interface LeaseBalanceAsOf {
  rou: number;
  liability: number;
  status: LeaseBalanceStatus;
  currentPortion: number;
  openingRou: number;
}

export interface BalanceScheduleRow {
  period_number: number;
  period_date: string;
  beginning_liability: number;
  payment_amount: number;
  interest_expense: number;
  principal_reduction: number;
  ending_liability: number;
  rou_asset_balance: number;
  depreciation_expense: number;
}

export const BALANCE_CONVENTION_NOTE =
  'Balances are taken from each lease schedule as of the selected date. Payments reduce the liability on their payment date (first day of the month for payments in advance, last day for payments in arrears). Interest and ROU amortization are recognised through the last completed month-end. Leases that have not started are excluded; ended leases show zero.';

const ymd = (s: string) => s.slice(0, 10);

export function monthEndOf(periodDate: string): string {
  const [y, m] = ymd(periodDate).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export function addMonthsYMD(date: string, months: number): string {
  const [y, m, d] = ymd(date).split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const num = (v: unknown) => Number(v) || 0;

const STATUSES: ReadonlySet<string> = new Set(['not_started', 'active', 'ended', 'no_schedule']);

interface BalanceRpcRow {
  lease_id: string;
  rou: number | string | null;
  liability: number | string | null;
  status: string;
  current_portion: number | string | null;
  opening_rou: number | string | null;
}

/** Balances for the given leases from the database rule. Leases the user cannot see are absent. */
export async function fetchLeaseBalancesAsOf(leaseIds: string[], asOf: string): Promise<Map<string, LeaseBalanceAsOf>> {
  const result = new Map<string, LeaseBalanceAsOf>();
  const batchSize = 200;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    const { data, error } = await supabase.rpc('get_lease_balances_as_of', { p_as_of: ymd(asOf), p_lease_ids: batch });
    if (error) throw new Error(`Failed to load lease balances: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('Failed to load lease balances: unexpected response');
    for (const row of data as BalanceRpcRow[]) {
      if (!row || typeof row.lease_id !== 'string' || !STATUSES.has(row.status)) {
        throw new Error('Failed to load lease balances: unexpected response');
      }
      result.set(row.lease_id, {
        rou: num(row.rou),
        liability: num(row.liability),
        status: row.status as LeaseBalanceStatus,
        currentPortion: num(row.current_portion),
        openingRou: num(row.opening_rou),
      });
    }
  }
  return result;
}

const SCHEDULE_COLUMNS =
  'lease_id, period_number, period_date, beginning_liability, payment_amount, interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense, short_term_lease_cost';

export type FullScheduleRow = BalanceScheduleRow & { lease_id: string; short_term_lease_cost: number };

export async function fetchSchedulesByLease(leaseIds: string[]): Promise<Map<string, FullScheduleRow[]>> {
  const orgId = await currentOrgId();
  const result = new Map<string, FullScheduleRow[]>();
  const batchSize = 100;
  const pageSize = 1000;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('amortization_schedules')
        .select(SCHEDULE_COLUMNS)
        .eq('organization_id', orgId)
        .in('lease_id', batch)
        .order('lease_id', { ascending: true })
        .order('period_number', { ascending: true })
        .order('id')
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Failed to load lease schedules: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const raw of data as FullScheduleRow[]) {
        const row: FullScheduleRow = {
          lease_id: raw.lease_id,
          period_number: num(raw.period_number),
          period_date: raw.period_date,
          beginning_liability: num(raw.beginning_liability),
          payment_amount: num(raw.payment_amount),
          interest_expense: num(raw.interest_expense),
          principal_reduction: num(raw.principal_reduction),
          ending_liability: num(raw.ending_liability),
          rou_asset_balance: num(raw.rou_asset_balance),
          depreciation_expense: num(raw.depreciation_expense),
          short_term_lease_cost: num(raw.short_term_lease_cost),
        };
        const list = result.get(row.lease_id);
        if (list) list.push(row);
        else result.set(row.lease_id, [row]);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }
  return result;
}

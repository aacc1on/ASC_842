import type { Lease } from '../../types/lease';
import { supabase } from '../../lib/supabase';
import { currentOrgId } from '../currentOrg';
import { fetchAll } from '../fetchAll';
import { addMonthsYMD, fetchLeaseBalancesAsOf, monthEndOf, type LeaseBalanceStatus } from '../leaseBalanceAsOf';

export interface CancellationTxn {
  lease_id: string;
  transaction_date: string;
  account_debited: string | null;
  account_credited: string | null;
  debit_amount: number | null;
  credit_amount: number | null;
}

export async function fetchCancellationTxns(leaseIds: string[], startStr: string, endStr: string): Promise<CancellationTxn[]> {
  const orgId = await currentOrgId();
  return fetchAll<CancellationTxn>('cancellation transactions', (from, to) => supabase
    .from('transactions')
    .select('lease_id, transaction_date, account_debited, account_credited, debit_amount, credit_amount')
    .eq('organization_id', orgId)
    .eq('transaction_type', 'lease_cancellation')
    .in('lease_id', leaseIds)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('id', { ascending: true })
    .range(from, to));
}

export interface LedgerRow {
  lease_id: string;
  date: string;
  account_debited: string;
  account_credited: string;
  amount: number;
  transaction_type: string;
}

export async function fetchDocumentedLedger(
  leaseIds: string[],
  startDate: string | null,
  endDate: string
): Promise<LedgerRow[]> {
  if (leaseIds.length === 0) return [];
  const orgId = await currentOrgId();

  const rows: LedgerRow[] = [];
  const batchSize = 200;

  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);

    const initialRows = await fetchAll<{ lease_id: string; transaction_date: string; transaction_type: string; account_debited: string; account_credited: string; amount: number }>(
      'lease events',
      (from, to) => {
        let q = supabase
          .from('lease_transactions')
          .select('lease_id, transaction_date, transaction_type, account_debited, account_credited, amount')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .in('transaction_type', ['initial_recognition', 'modification', 'remeasurement', 'termination', 'impairment'])
          .lte('transaction_date', endDate);
        if (startDate) q = q.gte('transaction_date', startDate);
        return q.order('id', { ascending: true }).range(from, to);
      },
    );
    for (const r of initialRows) {
      rows.push({
        lease_id: r.lease_id,
        date: String(r.transaction_date).split('T')[0],
        account_debited: r.account_debited,
        account_credited: r.account_credited,
        amount: Number(r.amount) || 0,
        transaction_type: r.transaction_type,
      });
    }

    const postedRows = await fetchAll<{ lease_id: string; transaction_date: string; transaction_type: string; account_debited: string; account_credited: string; debit_amount: number | null; credit_amount: number | null }>(
      'posted month-end transactions',
      (from, to) => {
        let q = supabase
          .from('transactions')
          .select('lease_id, transaction_date, transaction_type, account_debited, account_credited, debit_amount, credit_amount, month_end_document_id')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .not('month_end_document_id', 'is', null)
          .lte('transaction_date', endDate);
        if (startDate) q = q.gte('transaction_date', startDate);
        return q.order('id', { ascending: true }).range(from, to);
      },
    );
    for (const r of postedRows) {
      rows.push({
        lease_id: r.lease_id,
        date: String(r.transaction_date).split('T')[0],
        account_debited: r.account_debited,
        account_credited: r.account_credited,
        amount: Number(r.debit_amount ?? r.credit_amount) || 0,
        transaction_type: r.transaction_type,
      });
    }
  }
  return rows;
}

/**
 * Fetches gain/loss and cash outflow from lease_transactions rows posted by
 * the modification/cancellation engine (transaction_type 'termination' or
 * 'modification'). These are separate from the legacy 'lease_cancellation'
 * rows in the transactions table, so callers must include both to avoid
 * double counting.
 *
 * Returns an array of normalized rows with account names, amounts, and dates.
 */
export interface TerminationModRow {
  lease_id: string;
  transaction_date: string;
  account_debited: string;
  account_credited: string;
  amount: number;
  transaction_type: string;
}

export async function fetchTerminationModEntries(
  leaseIds: string[],
  startStr: string,
  endStr: string
): Promise<TerminationModRow[]> {
  if (leaseIds.length === 0) return [];
  const orgId = await currentOrgId();
  const result: TerminationModRow[] = [];
  const batchSize = 200;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    const data = await fetchAll<{ lease_id: string; transaction_date: string; transaction_type: string; account_debited: string; account_credited: string; amount: number }>(
      'lease events',
      (from, to) => supabase
        .from('lease_transactions')
        .select('lease_id, transaction_date, transaction_type, account_debited, account_credited, amount')
        .eq('organization_id', orgId)
        .in('lease_id', batch)
        .in('transaction_type', ['termination', 'modification', 'impairment'])
        .gte('transaction_date', startStr)
        .lte('transaction_date', endStr)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (data) {
      for (const r of data) {
        result.push({
          lease_id: r.lease_id,
          transaction_date: String(r.transaction_date).split('T')[0],
          account_debited: r.account_debited,
          account_credited: r.account_credited,
          amount: Number(r.amount) || 0,
          transaction_type: r.transaction_type,
        });
      }
    }
  }
  return result;
}

export interface ScheduleBalance {
  lease: Lease;
  rou: number;
  openingRou: number;
  liability: number;
  current: number;
  status: LeaseBalanceStatus;
}

// Per-lease balances from the database as-of rule (public.get_lease_balances_as_of).
export async function computeScheduleBalances(leases: Lease[], asOfStr: string): Promise<Map<string, ScheduleBalance>> {
  const balances = leases.length > 0 ? await fetchLeaseBalancesAsOf(leases.map((l) => l.id), asOfStr) : new Map();
  const out = new Map<string, ScheduleBalance>();
  for (const lease of leases) {
    const b = balances.get(lease.id);
    out.set(lease.id, {
      lease,
      rou: b?.rou ?? 0,
      openingRou: b?.openingRou ?? 0,
      liability: b?.liability ?? 0,
      current: b?.currentPortion ?? 0,
      status: b?.status ?? 'no_schedule',
    });
  }
  return out;
}

/**
 * Returns the earliest month (YYYY-MM) that has ended on or before asOf but is not posted,
 * scanning from the earliest commencement date. null = posted through asOf.
 */
export async function findFirstUnpostedMonth(earliestStart: string, asOfStr: string): Promise<string | null> {
  if (!earliestStart) return null;
  const orgId = await currentOrgId();
  const data = await fetchAll<{ period: string }>('month-end status', (from, to) => supabase
    .from('month_end_documents')
    .select('period, status')
    .eq('organization_id', orgId)
    .in('status', ['posted', 'finalized', 'closed'])
    .order('period', { ascending: true })
    .range(from, to));
  const posted = new Set(data.map((d) => String(d.period).slice(0, 7)));
  let cursor = `${earliestStart.slice(0, 7)}-01`;
  while (monthEndOf(cursor) <= asOfStr) {
    const key = cursor.slice(0, 7);
    if (!posted.has(key)) return key;
    cursor = addMonthsYMD(cursor, 1);
  }
  return null;
}

export interface RouAdjustments {
  modificationDelta: Map<string, number>;
  impairment: Map<string, number>;
}

/** Approved ROU remeasurement deltas and impairments dated on or before the report date, per lease. */
export async function fetchRouAdjustments(leaseIds: string[], asOfStr: string): Promise<RouAdjustments> {
  const wanted = new Set(leaseIds);
  const orgId = await currentOrgId();
  const [mods, imps] = await Promise.all([
    fetchAll<{ lease_id: string; old_rou_asset: number | null; new_rou_asset: number | null }>('lease modifications', (from, to) => supabase
      .from('contract_modifications')
      .select('lease_id, old_rou_asset, new_rou_asset')
      .eq('organization_id', orgId)
      .eq('status', 'approved')
      .lte('modification_date', asOfStr)
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAll<{ lease_id: string; impairment_amount: number | null }>('lease impairments', (from, to) => supabase
      .from('lease_impairments')
      .select('lease_id, impairment_amount')
      .eq('organization_id', orgId)
      .eq('status', 'approved')
      .lte('impairment_date', asOfStr)
      .order('id', { ascending: true })
      .range(from, to)),
  ]);
  const modificationDelta = new Map<string, number>();
  const impairment = new Map<string, number>();
  for (const m of mods) {
    if (!wanted.has(m.lease_id) || m.old_rou_asset == null || m.new_rou_asset == null) continue;
    modificationDelta.set(m.lease_id, (modificationDelta.get(m.lease_id) || 0) + Number(m.new_rou_asset) - Number(m.old_rou_asset));
  }
  for (const i of imps) {
    if (!wanted.has(i.lease_id)) continue;
    impairment.set(i.lease_id, (impairment.get(i.lease_id) || 0) + Number(i.impairment_amount || 0));
  }
  return { modificationDelta, impairment };
}

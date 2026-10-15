import { supabase } from '../../lib/supabase';
import { type Lease } from '../../types/lease';
import { currentOrgId } from '../currentOrg';
import { fetchAllIn } from '../fetchAll';
import { computeLeaseBalancesByType, generateBalanceSheet, generateProfitLossAndCashFlow } from '../financialReports';
import { getAllTransactions } from '../transactionGenerator';
import { buildLeaseEventEntries, buildPostedEntries, mergeLedgerEntries, type LedgerLookups, type PostedLedgerRow } from './ledger';
import { computeMonths, computeWeeks, toLocalPeriodRange, type MonthReport, type WeekReport } from './period';

const LEASE_EVENT_TYPES = new Set(['initial_recognition', 'modification', 'remeasurement', 'termination', 'derecognition']);

export async function loadFinancialSnapshot(filteredLeases: Lease[], leases: Lease[], periodStart: string, periodEnd: string, lookups: LedgerLookups) {
  const { pStart, pEnd } = toLocalPeriodRange(periodStart, periodEnd);
  const allowedLeaseIds = new Set(filteredLeases.map((l) => l.id));
  const orgId = await currentOrgId();

  const [bs, plcf, allStoredTxns, monthEndTxns, cancellationTxns, balancesType] = await Promise.all([
    generateBalanceSheet(filteredLeases, pEnd),
    generateProfitLossAndCashFlow(filteredLeases, pStart, pEnd),
    (async () => {
      const all = await getAllTransactions(pStart, pEnd);
      return all.filter((t) => LEASE_EVENT_TYPES.has(t.transaction_type) && allowedLeaseIds.has(t.lease_id));
    })(),
    fetchAllIn<PostedLedgerRow>('posted month-end transactions', Array.from(allowedLeaseIds), (batch, from, to) => supabase
      .from('transactions')
      .select('*, leases:lease_id(lease_name)')
      .eq('organization_id', orgId)
      .not('month_end_document_id', 'is', null)
      .in('lease_id', batch)
      .gte('transaction_date', periodStart)
      .lte('transaction_date', periodEnd)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAllIn<PostedLedgerRow>('cancellation transactions', Array.from(allowedLeaseIds), (batch, from, to) => supabase
      .from('transactions')
      .select('*, leases:lease_id(lease_name)')
      .eq('organization_id', orgId)
      .eq('transaction_type', 'lease_cancellation')
      .in('lease_id', batch)
      .gte('transaction_date', periodStart)
      .lte('transaction_date', periodEnd)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    computeLeaseBalancesByType(filteredLeases, pEnd),
  ]);

  const detailedLedger = mergeLedgerEntries(
    buildLeaseEventEntries(allStoredTxns, filteredLeases, lookups),
    buildPostedEntries(monthEndTxns || [], leases, lookups),
    buildPostedEntries(cancellationTxns || [], leases, lookups),
  );
  return { balanceSheet: bs, balancesByType: balancesType, profitLoss: plcf.pl, cashFlow: plcf.cf, detailedLedger };
}

export async function loadWeekReports(leases: Lease[], periodStart: string, periodEnd: string): Promise<WeekReport[]> {
  const weeks = computeWeeks(periodStart, periodEnd);
  if (weeks.length < 2) return [];
  return Promise.all(weeks.map(async (w) => {
    const { pl, cf } = await generateProfitLossAndCashFlow(leases, new Date(w.start + 'T00:00:00'), new Date(w.end + 'T00:00:00'));
    return { week: w, pl, cf };
  }));
}

export async function loadMonthReports(leases: Lease[], periodStart: string, periodEnd: string): Promise<MonthReport[]> {
  const months = computeMonths(periodStart, periodEnd);
  if (months.length < 2) return [];
  return Promise.all(months.map(async (mo) => {
    const { pl, cf } = await generateProfitLossAndCashFlow(leases, new Date(mo.start + 'T00:00:00'), new Date(mo.end + 'T00:00:00'));
    return { month: mo, pl, cf };
  }));
}

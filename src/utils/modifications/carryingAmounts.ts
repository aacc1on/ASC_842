import { supabase } from '../../lib/supabase';
import { round2 } from '../leaseCalculations';
import { fetchAll } from '../fetchAll';
import { periodToDate } from './remeasurement';
import type { CarryingAmounts } from './types';
import { currentOrgId } from '../currentOrg';

/**
 * Reads the stored amortization_schedules rows and returns the carrying
 * amounts (ROU asset, lease liability) at the last period ending before the
 * given date. Also returns the number of completed periods.
 */
export async function getCarryingAmountsAtDate(
  leaseId: string,
  targetDate: string
): Promise<CarryingAmounts> {
  const orgId = await currentOrgId();
  const scheduleRows = await fetchAll<{ period_number: number; period_date: string; rou_asset_balance: number; ending_liability: number }>(
    'amortization schedule',
    (from, to) => supabase
      .from('amortization_schedules')
      .select('*')
      .eq('organization_id', orgId)
      .eq('lease_id', leaseId)
      .order('period_number', { ascending: true })
      .range(from, to),
  );

  if (scheduleRows.length === 0) {
    throw new Error('No amortization schedule found for this lease');
  }

  const target = new Date(targetDate.split('T')[0] + 'T00:00:00');
  let lastCompleted: { rou_asset_balance: number; ending_liability: number; period_number: number } | null = null;
  let periodsCompleted = 0;

  for (const row of scheduleRows) {
    const rowDate = periodToDate(row.period_date);
    if (rowDate < target) {
      lastCompleted = row;
      periodsCompleted = row.period_number;
    }
  }

  if (!lastCompleted) {
    throw new Error('Modification date must be after at least one payment period');
  }

  return {
    rouAsset: round2(Number(lastCompleted.rou_asset_balance)),
    leaseLiability: round2(Number(lastCompleted.ending_liability)),
    periodsCompleted,
  };
}

/**
 * Shared helper: checks the 'transactions' table for posted month-end entries
 * for a given lease. Month-end entries are the rows in 'transactions' with a
 * non-null month_end_document_id (the same rule financialReports.ts uses).
 *
 * When fromDate is provided, only counts rows with transaction_date >= fromDate
 * (used to block modifications/cancellations over already-posted months).
 *
 * Returns true if posted month-end entries exist.
 */
export async function hasPostedMonthEnd(
  leaseId: string,
  fromDate?: string
): Promise<boolean> {
  const orgId = await currentOrgId();
  let query = supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('lease_id', leaseId)
    .not('month_end_document_id', 'is', null);
  if (fromDate) {
    query = query.gte('transaction_date', fromDate);
  }
  const { count } = await query;
  return (count ?? 0) > 0;
}

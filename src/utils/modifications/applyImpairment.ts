import { supabase } from '../../lib/supabase';
import type { Lease } from '../../types/lease';
import { fetchAll } from '../fetchAll';
import { getCarryingAmountsAtDate, hasPostedMonthEnd } from './carryingAmounts';
import { computeImpairment } from './impairment';
import type { ImpairmentResult, ScheduleRow, TransactionInsert } from './types';
import { currentOrgId } from '../currentOrg';

/**
 * Applies an ROU asset impairment: posts the impairment journal entry, updates
 * the lease ROU balance, rebuilds the remaining schedule, deletes superseded
 * month-end transactions, and marks the impairment as posted.
 *
 * Blocks if already posted or if month-end entries are posted after the
 * impairment date.
 */
export async function applyImpairment(
  impairmentId: string,
  lease: Lease,
  impairmentDate: string,
  impairmentAmount: number,
  reason: string,
  userId: string,
): Promise<ImpairmentResult> {
  const orgId = await currentOrgId();
  // Check if already posted
  const { data: impRow } = await supabase
    .from('lease_impairments')
    .select('posted')
    .eq('organization_id', orgId)
    .eq('id', impairmentId)
    .single();

  if (impRow?.posted) {
    throw new Error('Impairment has already been applied.');
  }

  // Block if month-end posted after impairment date
  const blocked = await hasPostedMonthEnd(lease.id, impairmentDate);
  if (blocked) {
    throw new Error('Month-end entries are already posted for periods after the impairment date. Please reverse those entries first.');
  }

  const carrying = await getCarryingAmountsAtDate(lease.id, impairmentDate);

  // Validate impairment amount
  if (impairmentAmount <= 0) {
    throw new Error('Impairment amount must be greater than zero.');
  }
  if (impairmentAmount > carrying.rouAsset) {
    throw new Error(
      `Impairment amount (${impairmentAmount.toFixed(2)}) exceeds the carrying ROU asset amount (${carrying.rouAsset.toFixed(2)}).`
    );
  }

  // Fetch the existing stored schedule rows after the carrying date — these
  // contain the correct payment, interest, principal and liability values
  // (preserving payment frequency, tranches, RVG, purchase option). The
  // impairment only changes the ROU asset side.
  const existingRows = await fetchAll<{
    period_number: number; period_date: string; beginning_liability: number; payment_amount: number; interest_expense: number;
    principal_reduction: number; ending_liability: number; rou_asset_balance: number; depreciation_expense: number;
  }>('amortization schedule', (from, to) => supabase
    .from('amortization_schedules')
    .select('period_number, period_date, beginning_liability, payment_amount, interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense')
    .eq('organization_id', orgId)
    .eq('lease_id', lease.id)
    .gt('period_number', carrying.periodsCompleted)
    .order('period_number', { ascending: true })
    .range(from, to));

  if (existingRows.length === 0) {
    throw new Error('No remaining amortization schedule rows found after the impairment date.');
  }

  const existingSchedule: ScheduleRow[] = existingRows.map((r) => ({
    period_number: Number(r.period_number),
    period_date: String(r.period_date).split('T')[0],
    beginning_liability: Number(r.beginning_liability) || 0,
    payment_amount: Number(r.payment_amount) || 0,
    interest_expense: Number(r.interest_expense) || 0,
    principal_reduction: Number(r.principal_reduction) || 0,
    ending_liability: Number(r.ending_liability) || 0,
    rou_asset_balance: Number(r.rou_asset_balance) || 0,
    depreciation_expense: Number(r.depreciation_expense) || 0,
  }));

  const result = computeImpairment(
    carrying,
    impairmentAmount,
    existingSchedule,
  );

  // Post journal entry: Dr "Impairment Loss - ROU Asset" / Cr "Right-of-Use Asset"
  const txns: TransactionInsert[] = [{
    user_id: userId,
    lease_id: lease.id,
    transaction_date: impairmentDate,
    transaction_type: 'impairment',
    description: `ROU asset impairment: ${lease.lease_name}. Amount: ${impairmentAmount.toFixed(2)}. Reason: ${reason || 'N/A'}`,
    account_debited: 'Impairment Loss - ROU Asset',
    account_credited: 'Right-of-Use Asset',
    amount: impairmentAmount,
    organization_id: lease.organization_id,
  }];

  const { error: txnError } = await supabase.from('lease_transactions').insert(txns);
  if (txnError) throw txnError;

  // Update lease: rou_asset = rouAfter
  const { error: leaseError } = await supabase
    .from('leases')
    .update({
      rou_asset: result.rouAfter,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lease.id);
  if (leaseError) throw leaseError;

  // Delete superseded schedule rows
  const { error: delSchedError } = await supabase
    .from('amortization_schedules')
    .delete()
    .eq('lease_id', lease.id)
    .gt('period_number', carrying.periodsCompleted);
  if (delSchedError) throw delSchedError;

  // Insert new schedule rows
  if (result.remainingSchedule.length > 0) {
    const scheduleInsert = result.remainingSchedule.map((r) => ({
      lease_id: lease.id,
      period_number: r.period_number,
      period_date: r.period_date,
      beginning_liability: r.beginning_liability,
      payment_amount: r.payment_amount,
      interest_expense: r.interest_expense,
      principal_reduction: r.principal_reduction,
      ending_liability: r.ending_liability,
      rou_asset_balance: r.rou_asset_balance,
      depreciation_expense: r.depreciation_expense,
    }));
    const { error: schedError } = await supabase.from('amortization_schedules').insert(scheduleInsert);
    if (schedError) throw schedError;
  }

  // Delete superseded month-end transactions after impairment date
  const { error: delTxnError } = await supabase
    .from('lease_transactions')
    .delete()
    .eq('lease_id', lease.id)
    .gte('transaction_date', impairmentDate)
    .in('transaction_type', ['payment', 'interest', 'amortization', 'operating_lease_expense']);
  if (delTxnError) throw delTxnError;

  // Update lease_impairments with posted = true
  const { error: impError } = await supabase
    .from('lease_impairments')
    .update({ posted: true })
    .eq('id', impairmentId);
  if (impError) throw impError;

  // Write to audit_log
  const { error: auditError } = await supabase.from('audit_log').insert({
    organization_id: lease.organization_id,
    actor_user_id: userId,
    table_name: 'leases',
    record_id: lease.id,
    action: 'impairment',
    old_data: { rou_asset: carrying.rouAsset },
    new_data: {
      impairment_amount: impairmentAmount,
      impairment_date: impairmentDate,
      reason,
      rou_asset_after: result.rouAfter,
    },
  });
  if (auditError) throw auditError;

  return result;
}

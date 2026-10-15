import { supabase } from '../../lib/supabase';
import type { Lease } from '../../types/lease';
import { round2 } from '../leaseCalculations';
import { fetchAll } from '../fetchAll';
import { getCarryingAmountsAtDate, hasPostedMonthEnd } from './carryingAmounts';
import { computeCancellation } from './cancellation';
import type { CancellationResult, TransactionInsert } from './types';
import { currentOrgId } from '../currentOrg';

/**
 * Applies a cancellation: posts derecognition entries, sets lease status to
 * 'terminated', deletes schedule rows after the cancellation date, and marks
 * derecognition_posted = true.
 * For short-term exempt leases, posts only the penalty/final payment to expense.
 */
export async function applyCancellation(
  cancellationId: string,
  lease: Lease,
  cancellationDate: string,
  terminationPenalty: number,
  finalPayment: number,
  userId: string,
): Promise<CancellationResult> {
  const orgId = await currentOrgId();
  // Check if already applied
  const { data: canRow } = await supabase
    .from('contract_cancellations')
    .select('derecognition_posted')
    .eq('organization_id', orgId)
    .eq('id', cancellationId)
    .single();

  if (canRow?.derecognition_posted) {
    throw new Error('Cancellation has already been applied.');
  }

  // Block if month-end posted after cancellation date
  const blocked = await hasPostedMonthEnd(lease.id, cancellationDate);
  if (blocked) {
    throw new Error('Month-end entries are already posted for periods after the cancellation date. Please reverse those entries first.');
  }

  const isShortTerm = lease.accounting_treatment === 'short_term_exemption';
  const txns: TransactionInsert[] = [];
  let result: CancellationResult;

  if (isShortTerm) {
    // Short-term: just post penalty + final payment to expense
    const totalCash = round2(terminationPenalty + finalPayment);
    if (totalCash > 0) {
      txns.push({
        user_id: userId,
        lease_id: lease.id,
        transaction_date: cancellationDate,
        transaction_type: 'termination',
        description: `Lease termination expense (short-term): ${lease.lease_name}`,
        account_debited: 'Short-Term Lease Expense',
        account_credited: 'Cash',
        amount: totalCash,
        organization_id: lease.organization_id,
      });
    }
    result = computeCancellation(0, 0, terminationPenalty, finalPayment);
  } else {
    const carrying = await getCarryingAmountsAtDate(lease.id, cancellationDate);
    result = computeCancellation(carrying.rouAsset, carrying.leaseLiability, terminationPenalty, finalPayment);

    const totalCash = round2(terminationPenalty + finalPayment);

    // Post exactly four lines (three if cash is zero):
    //   Dr Lease Liability         = carrying liability
    //   Cr Right-of-Use Asset      = carrying ROU
    //   Cr Cash                    = penalty + final payment (if > 0)
    //   Dr Loss / Cr Gain on Term  = plug = liability - ROU - cash
    //
    // The gain/loss sign: if liability > ROU + cash, the lessee
    // extinguishes the liability for more than the assets given up →
    // loss (debit).  If liability < ROU + cash → gain (credit).

    txns.push({
      user_id: userId,
      lease_id: lease.id,
      transaction_date: cancellationDate,
      transaction_type: 'termination',
      description: `Lease liability derecognized on termination: ${lease.lease_name}`,
      account_debited: 'Lease Liability',
      account_credited: '_plug',
      amount: result.carryingLiability,
      organization_id: lease.organization_id,
    });

    txns.push({
      user_id: userId,
      lease_id: lease.id,
      transaction_date: cancellationDate,
      transaction_type: 'termination',
      description: `ROU asset derecognized on termination: ${lease.lease_name}`,
      account_debited: '_plug',
      account_credited: 'Right-of-Use Asset',
      amount: result.carryingRouAsset,
      organization_id: lease.organization_id,
    });

    if (totalCash > 0) {
      txns.push({
        user_id: userId,
        lease_id: lease.id,
        transaction_date: cancellationDate,
        transaction_type: 'termination',
        description: `Cash paid on lease termination: ${lease.lease_name}`,
        account_debited: '_plug',
        account_credited: 'Cash',
        amount: totalCash,
        organization_id: lease.organization_id,
      });
    }

    // Plug line: gain or loss = liability - ROU - cash
    const plug = round2(result.carryingLiability - result.carryingRouAsset - totalCash);
    if (Math.abs(plug) > 0.005) {
      if (plug > 0) {
        // Loss: liability exceeds ROU + cash paid
        txns.push({
          user_id: userId,
          lease_id: lease.id,
          transaction_date: cancellationDate,
          transaction_type: 'termination',
          description: `Loss on lease termination: ${lease.lease_name}`,
          account_debited: 'Loss on Lease Termination',
          account_credited: '_plug',
          amount: plug,
          organization_id: lease.organization_id,
        });
      } else {
        // Gain: ROU + cash exceeds liability
        txns.push({
          user_id: userId,
          lease_id: lease.id,
          transaction_date: cancellationDate,
          transaction_type: 'termination',
          description: `Gain on lease termination: ${lease.lease_name}`,
          account_debited: '_plug',
          account_credited: 'Gain on Lease Termination',
          amount: Math.abs(plug),
          organization_id: lease.organization_id,
        });
      }
    }

    // Now resolve _plug placeholders: each transaction row has either
    // account_debited or account_credited set to '_plug'. The plug line
    // above balances the other side. We set the placeholder to the
    // matching gain/loss account so every row has real accounts.
    const plugAccount = plug > 0 ? 'Loss on Lease Termination' : 'Gain on Lease Termination';
    for (const t of txns) {
      if (t.account_debited === '_plug') t.account_debited = plugAccount;
      if (t.account_credited === '_plug') t.account_credited = plugAccount;
    }
  }

  if (txns.length > 0) {
    const { error: txnError } = await supabase.from('lease_transactions').insert(txns);
    if (txnError) throw txnError;
  }

  // Set lease status to 'terminated' and end date to cancellation date
  const { error: leaseError } = await supabase
    .from('leases')
    .update({
      status: 'terminated',
      lease_end_date: cancellationDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lease.id);
  if (leaseError) throw leaseError;

  // Delete schedule rows after the cancellation date
  const cancelDateObj = new Date(cancellationDate.split('T')[0] + 'T00:00:00');
  const cancelYearMonth = cancelDateObj.getFullYear() * 12 + cancelDateObj.getMonth();

  const allSchedRows = await fetchAll<{ id: string; period_date: string }>('amortization schedule', (from, to) => supabase
    .from('amortization_schedules')
    .select('id, period_date')
    .eq('organization_id', orgId)
    .eq('lease_id', lease.id)
    .order('period_number', { ascending: true })
    .range(from, to));

  if (allSchedRows.length > 0) {
    const idsToDelete: string[] = [];
    for (const row of allSchedRows) {
      const [ry, rm] = row.period_date.split('T')[0].split('-').map(Number);
      const rowYM = ry * 12 + (rm - 1);
      if (rowYM > cancelYearMonth) {
        idsToDelete.push(row.id);
      }
    }
    if (idsToDelete.length > 0) {
      const { error: delError } = await supabase
        .from('amortization_schedules')
        .delete()
        .in('id', idsToDelete);
      if (delError) throw delError;
    }
  }

  // Update contract_cancellations with computed values + derecognition_posted
  const { error: canError } = await supabase
    .from('contract_cancellations')
    .update({
      remaining_rou_asset: result.carryingRouAsset,
      remaining_lease_liability: result.carryingLiability,
      gain_loss_amount: result.isGain ? result.gainLoss : -result.gainLoss,
      derecognition_posted: true,
    })
    .eq('id', cancellationId);
  if (canError) throw canError;

  return result;
}

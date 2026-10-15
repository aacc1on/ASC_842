import { supabase } from '../../lib/supabase';
import type { Lease } from '../../types/lease';
import { determineLeaseClassification } from '../leaseClassification';
import { getCarryingAmountsAtDate, hasPostedMonthEnd } from './carryingAmounts';
import { computeModification } from './remeasurement';
import type { ModificationResult, TransactionInsert } from './types';
import { currentOrgId } from '../currentOrg';

/**
 * Applies a modification: posts journal entries, updates the lease, regenerates
 * the remaining schedule, and marks accounting_posted = true.
 * Blocks if month-end entries are posted after the modification date or if
 * already applied (accounting_posted = true).
 *
 * When separateContract is true, the modification grants an additional right
 * of use priced at its standalone price and is accounted for as a new, separate
 * lease. No remeasurement, journal entries, lease update, or schedule rebuild
 * is performed — only the modification row is marked posted with
 * reassessed_classification = 'separate_contract'.
 */
export async function applyModification(
  modificationId: string,
  lease: Lease,
  modificationDate: string,
  newPayment: number,
  newRemainingTerm: number,
  newDiscountRate: number,
  userId: string,
  separateContract: boolean = false,
  fairValueAtModification: number | null = null,
  remainingEconomicLifeMonths: number | null = null,
): Promise<ModificationResult> {
  const orgId = await currentOrgId();
  // Check if already applied
  const { data: modRow } = await supabase
    .from('contract_modifications')
    .select('accounting_posted')
    .eq('organization_id', orgId)
    .eq('id', modificationId)
    .single();

  if (modRow?.accounting_posted) {
    throw new Error('Modification has already been applied.');
  }

  // Block if month-end posted after modification date
  const blocked = await hasPostedMonthEnd(lease.id, modificationDate);
  if (blocked) {
    throw new Error('Month-end entries are already posted for periods after the modification date. Please reverse those entries first.');
  }

  // Separate contract: do NOT remeasure, post journals, update lease, or
  // rebuild the schedule. Just mark the modification as posted.
  if (separateContract) {
    const { error: sepError } = await supabase
      .from('contract_modifications')
      .update({
        accounting_posted: true,
        reassessed_classification: 'separate_contract',
      })
      .eq('id', modificationId);
    if (sepError) throw sepError;

    return {
      oldRouAsset: 0,
      oldLiability: 0,
      newRouAsset: 0,
      newLiability: 0,
      liabilityChange: 0,
      rouChange: 0,
      gainOnModification: 0,
      remainingSchedule: [],
      newLeaseEndDate: lease.lease_end_date,
      newLeaseTermMonths: lease.lease_term_months,
    };
  }

  const carrying = await getCarryingAmountsAtDate(lease.id, modificationDate);

  // Reassess the lease classification at the modification date using the
  // remeasured liability as the present value. We compute the modification
  // first (using the original classification) to obtain the new liability,
  // then run the classification test and, if it differs, rebuild the schedule
  // with the reassessed classification.
  const effectiveRvg = Number(lease.rvg_probable_amount ?? lease.residual_value_guarantee ?? 0);

  // Build the options object for computeModification. When the reassessed
  // classification differs from the lease's current classification, we rebuild
  // the schedule with the new classification so the remaining term uses the
  // right interest/depreciation pattern.
  const buildOptions = (classification: 'operating' | 'finance') => ({
    classification,
    purchaseOptionPrice: Number(lease.purchase_option_price) || 0,
    purchaseOptionReasonablyCertain: !!lease.purchase_option_reasonably_certain,
    rvgProbableAmount: effectiveRvg,
    amortizeOverUsefulLife:
      classification === 'finance' &&
      (!!lease.transfer_ownership || !!lease.purchase_option_reasonably_certain),
    usefulLifeMonths: remainingEconomicLifeMonths ?? undefined,
  });

  let result = computeModification(lease, carrying, newPayment, newRemainingTerm, newDiscountRate, buildOptions(lease.lease_classification));

  // Reassess classification at the modification date.
  const assetEconomicLifeMonths = remainingEconomicLifeMonths
    ?? (Number(lease.asset_economic_life_months) || 0);
  const assetFairValue = fairValueAtModification || Number(lease.asset_fair_value) || 0;

  const classificationResult = determineLeaseClassification({
    leaseTermMonths: newRemainingTerm,
    assetEconomicLifeMonths,
    presentValue: result.newLiability,
    assetFairValue,
    transferOwnership: !!lease.transfer_ownership,
    purchaseOption: !!lease.purchase_option,
    purchaseOptionReasonablyCertain: !!lease.purchase_option_reasonably_certain,
    purchaseOptionPrice: Number(lease.purchase_option_price) || 0,
    specializedAsset: !!lease.specialized_asset,
  });

  const reassessedClassification = classificationResult.classification;

  // If the reassessed classification differs from the lease's current
  // classification, rebuild the schedule using the new classification.
  if (reassessedClassification !== lease.lease_classification) {
    result = computeModification(lease, carrying, newPayment, newRemainingTerm, newDiscountRate, buildOptions(reassessedClassification));
  }

  // Post journal entries
  const txns: TransactionInsert[] = [];

  if (Math.abs(result.liabilityChange) > 0.01) {
    txns.push({
      user_id: userId,
      lease_id: lease.id,
      modification_id: modificationId,
      transaction_date: modificationDate,
      transaction_type: 'modification',
      description: `Lease modification — liability remeasured: ${lease.lease_name}. Liability: ${result.oldLiability.toFixed(2)} → ${result.newLiability.toFixed(2)}, ROU: ${result.oldRouAsset.toFixed(2)} → ${result.newRouAsset.toFixed(2)}`,
      account_debited: result.liabilityChange > 0 ? 'Right-of-Use Asset' : 'Lease Liability',
      account_credited: result.liabilityChange > 0 ? 'Lease Liability' : 'Right-of-Use Asset',
      amount: Math.abs(result.liabilityChange),
      organization_id: lease.organization_id,
    });
  }

  if (result.gainOnModification > 0.01) {
    txns.push({
      user_id: userId,
      lease_id: lease.id,
      modification_id: modificationId,
      transaction_date: modificationDate,
      transaction_type: 'modification',
      description: `Gain on lease modification (ROU reduced below zero): ${lease.lease_name}`,
      account_debited: 'Lease Liability',
      account_credited: 'Gain on Lease Modification',
      amount: result.gainOnModification,
      organization_id: lease.organization_id,
    });
  }

  if (txns.length > 0) {
    const { error: txnError } = await supabase.from('lease_transactions').insert(txns);
    if (txnError) throw txnError;
  }

  // Update the lease — also update the classification when it changed.
  const leaseUpdate: Record<string, unknown> = {
    payment_amount: newPayment,
    lease_term_months: result.newLeaseTermMonths,
    lease_end_date: result.newLeaseEndDate,
    incremental_borrowing_rate: newDiscountRate,
    discount_rate: newDiscountRate,
    rou_asset: result.newRouAsset,
    lease_liability: result.newLiability,
    updated_at: new Date().toISOString(),
  };
  if (reassessedClassification !== lease.lease_classification) {
    leaseUpdate.lease_classification = reassessedClassification;
  }

  const { error: leaseError } = await supabase
    .from('leases')
    .update(leaseUpdate)
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

  // Delete superseded month-end transactions
  const { error: delTxnError } = await supabase
    .from('lease_transactions')
    .delete()
    .eq('lease_id', lease.id)
    .gte('transaction_date', modificationDate)
    .in('transaction_type', ['payment', 'interest', 'amortization', 'operating_lease_expense']);
  if (delTxnError) throw delTxnError;

  // Update contract_modifications with computed values + accounting_posted +
  // the reassessed classification.
  const { error: modError } = await supabase
    .from('contract_modifications')
    .update({
      old_rou_asset: result.oldRouAsset,
      new_rou_asset: result.newRouAsset,
      old_lease_liability: result.oldLiability,
      new_lease_liability: result.newLiability,
      accounting_posted: true,
      reassessed_classification: reassessedClassification,
    })
    .eq('id', modificationId);
  if (modError) throw modError;

  return result;
}

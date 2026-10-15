import type { Lease } from '../../types/lease';

type NumberInput = number | string | null | undefined;

export interface ModificationContentInput {
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  old_monthly_payment: NumberInput;
  new_monthly_payment: NumberInput;
  old_lease_term: NumberInput;
  new_lease_term: NumberInput;
  old_discount_rate: NumberInput;
  new_discount_rate: NumberInput;
  notes: string;
  separate_contract: boolean;
  new_fair_value: NumberInput;
  new_economic_life_months: NumberInput;
}

export interface CancellationContentInput {
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: NumberInput;
  final_payment_amount: NumberInput;
  settlement_details: string;
}

/** Missing or blank input falls back; an explicit 0 is kept. */
export function numberOr(value: NumberInput, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function numberOrNull(value: NumberInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Fields a user may change on a modification. Never includes owner, organization or status. */
export function modificationContent(form: ModificationContentInput, lease: Lease | undefined) {
  const lifeMonths = numberOrNull(form.new_economic_life_months);
  return {
    lease_id: form.lease_id,
    modification_date: form.modification_date,
    modification_type: form.modification_type,
    reason: form.reason,
    old_monthly_payment: numberOr(form.old_monthly_payment, Number(lease?.payment_amount ?? 0)),
    new_monthly_payment: numberOr(form.new_monthly_payment, 0),
    old_lease_term: numberOr(form.old_lease_term, Number(lease?.lease_term_months ?? 0)),
    new_lease_term: numberOr(form.new_lease_term, 0),
    old_discount_rate: numberOr(
      form.old_discount_rate,
      Number(lease?.discount_rate ?? lease?.incremental_borrowing_rate ?? 0),
    ),
    new_discount_rate: numberOr(form.new_discount_rate, 0),
    notes: form.notes,
    separate_contract: form.separate_contract,
    fair_value_at_modification: form.separate_contract ? null : numberOrNull(form.new_fair_value),
    remaining_economic_life_months: form.separate_contract || lifeMonths === null ? null : Math.round(lifeMonths),
  };
}

/** Fields a user may change on a cancellation, with preview carrying amounts from the lease. */
export function cancellationContent(form: CancellationContentInput, lease: Lease | undefined) {
  const rou = Number(lease?.rou_asset ?? 0);
  const liability = Number(lease?.lease_liability ?? 0);
  const penalty = numberOr(form.termination_penalty, 0);
  const finalPayment = numberOr(form.final_payment_amount, 0);
  return {
    lease_id: form.lease_id,
    cancellation_date: form.cancellation_date,
    cancellation_reason: form.cancellation_reason,
    early_termination: form.early_termination,
    termination_penalty: penalty,
    remaining_rou_asset: rou,
    remaining_lease_liability: liability,
    gain_loss_amount: liability - rou - penalty - finalPayment,
    final_payment_amount: finalPayment,
    settlement_details: form.settlement_details,
  };
}

/** Ownership and workflow fields set only when a record is first created. */
export function newItemFields(userId: string | null, lease: Lease | undefined) {
  return {
    user_id: userId,
    organization_id: lease?.organization_id,
    status: 'pending_approval',
  };
}

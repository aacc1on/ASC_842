import type { ContractModification } from '../../types/lease';

/**
 * Modification row shape for the ContractModificationView. Extends the base
 * `ContractModification` with the display-only lease name and extra columns.
 */
export interface ContractModificationRow extends ContractModification {
  lease_name?: string;
  old_discount_rate?: number;
  new_discount_rate?: number;
  notes?: string;
  separate_contract?: boolean;
  fair_value_at_modification?: number | null;
  remaining_economic_life_months?: number | null;
  reassessed_classification?: string | null;
}

/**
 * Cancellation row shape for the ContractModificationView. Mirrors the
 * `contract_cancellations` table columns the view actually renders.
 */
export interface ContractCancellation {
  id: string;
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  remaining_rou_asset: number;
  remaining_lease_liability: number;
  gain_loss_amount: number;
  final_payment_amount: number;
  settlement_details?: string;
  approved_by?: string | null;
  status: string;
  derecognition_posted: boolean;
  lease_name?: string;
}

/**
 * Modification form state for ContractModificationView.
 */
export interface ContractModificationForm {
  id?: string;
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  old_monthly_payment: number | null;
  new_monthly_payment: number;
  old_lease_term: number | null;
  new_lease_term: number;
  old_discount_rate: number | null;
  new_discount_rate: number;
  notes: string;
  separate_contract: boolean;
  new_fair_value: number | null;
  new_economic_life_months: number | null;
  new_classification: string;
}

/**
 * Cancellation form state for ContractModificationView.
 */
export interface ContractCancellationForm {
  id?: string;
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  final_payment_amount: number;
  settlement_details: string;
}

/** Filter modifications by a free-text search across display fields. */
export function filteredModifications(
  modifications: ContractModificationRow[],
  searchQuery: string,
): ContractModificationRow[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return modifications;
  return modifications.filter((m) =>
    [m.lease_name, m.reason, m.modification_type].some((s) =>
      s?.toLowerCase().includes(q),
    ),
  );
}

/** Filter cancellations by a free-text search across display fields. */
export function filteredCancellations(
  cancellations: ContractCancellation[],
  searchQuery: string,
): ContractCancellation[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return cancellations;
  return cancellations.filter((c) =>
    [c.lease_name, c.cancellation_reason].some((s) => s?.toLowerCase().includes(q)),
  );
}

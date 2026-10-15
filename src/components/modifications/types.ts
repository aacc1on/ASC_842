import type { UserPermissions, UserRole } from '../../App';
import type { ContractModification, Lease } from '../../types/lease';

// Re-export Lease so sibling modules can import it from the local barrel.
export type { Lease };

export interface ModificationsModuleProps {
  permissions: UserPermissions;
  userRole?: UserRole;
  selectedCompanyId?: string | null;
}

/**
 * Row shape used by the ModificationsModule views. The underlying
 * `contract_modifications` table carries more columns than the base
 * `ContractModification` type, so we extend it with the display-only fields.
 */
export interface ModificationRow extends ContractModification {
  lease_name?: string;
  accounting_posted?: boolean;
  old_discount_rate?: number;
  new_discount_rate?: number;
  accounting_treatment?: string;
  remeasurement_required?: boolean;
  notes?: string;
  separate_contract?: boolean;
  fair_value_at_modification?: number | null;
  remaining_economic_life_months?: number | null;
  reassessed_classification?: string | null;
}

/**
 * Row shape for `contract_cancellations`.
 */
export interface CancellationRow {
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

export interface ModificationFormData {
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
  accounting_treatment: string;
  remeasurement_required: boolean;
  notes: string;
  separate_contract: boolean;
  new_classification: 'operating' | 'finance';
  new_fair_value: number | null;
  new_economic_life_months: number | null;
}

export interface CancellationFormData {
  id?: string;
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  final_payment_amount: number;
  settlement_details: string;
}

export interface RemeasurementPreview {
  new_rou_asset: number;
  new_lease_liability: number;
  old_rou_asset: number;
  old_lease_liability: number;
  rou_adjustment: number;
  liability_adjustment: number;
}

export type LeaseList = Lease[];

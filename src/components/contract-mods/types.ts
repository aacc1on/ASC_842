export const MOD_PAGE_SIZE = 10;

export interface Modification {
  id: string;
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  old_monthly_payment: number;
  new_monthly_payment: number;
  old_lease_term: number;
  new_lease_term: number;
  old_discount_rate: number;
  new_discount_rate: number;
  accounting_treatment: string;
  status: string;
  approved_by: string;
  notes: string;
  created_at: string;
  lease_name?: string;
}

export interface Cancellation {
  id: string;
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  remaining_rou_asset: number;
  remaining_lease_liability: number;
  gain_loss_amount: number;
  settlement_details: string;
  status: string;
  approved_by: string;
  derecognition_posted: boolean;
  created_at: string;
}

export interface Lease {
  id: string;
  lease_name: string;
  payment_amount: number;
  lease_term_months: number;
  incremental_borrowing_rate: number;
  lease_start_date: string;
  lease_end_date: string;
  payment_timing: string;
  initial_direct_costs: number | null;
  lease_incentives: number | null;
  residual_value_guarantee: number | null;
}

export interface ModificationForm {
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  new_monthly_payment: number;
  new_lease_term: number;
  new_discount_rate: number;
  accounting_treatment: string;
  notes: string;
}

export interface CancellationForm {
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  remaining_rou_asset: number;
  remaining_lease_liability: number;
  settlement_details: string;
}

export const initialModificationForm = (): ModificationForm => ({
  lease_id: '',
  modification_date: new Date().toISOString().split('T')[0],
  modification_type: 'payment_change',
  reason: '',
  new_monthly_payment: 0,
  new_lease_term: 0,
  new_discount_rate: 0,
  accounting_treatment: 'remeasurement',
  notes: '',
});

export const initialCancellationForm = (): CancellationForm => ({
  lease_id: '',
  cancellation_date: new Date().toISOString().split('T')[0],
  cancellation_reason: '',
  early_termination: false,
  termination_penalty: 0,
  remaining_rou_asset: 0,
  remaining_lease_liability: 0,
  settlement_details: '',
});

export type ActionTargetType = 'modification' | 'cancellation';

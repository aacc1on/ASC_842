import type { Lease, FixedAssetType, Branch } from '../../types/lease';

// Re-export shared domain types so lease-form sub-components can import them
// from their local barrel without reaching across the tree.
export type { FixedAssetType, Branch };

export interface PaymentTrancheRow {
  id: string;
  fromMonth: number;
  toMonth: number;
  paymentAmount: string | number;
}

/** Coverage summary for variable payment tranches vs. the lease term. */
export interface ScheduleCoverage {
  total: number;
  covered: number;
}

export interface ClassificationResult {
  classification: 'finance' | 'operating';
  reasons: string[];
}

export interface LeaseFormData {
  lease_name: string;
  lease_description: string;
  lessor_name: string;
  lessor_type: Lease['lessor_type'];
  lease_start_date: string;
  lease_end_date: string;
  lease_term_months: string | number;
  payment_amount: string | number;
  payment_frequency: string;
  incremental_borrowing_rate: string | number;
  lease_classification: 'operating' | 'finance';
  initial_direct_costs: string | number;
  lease_incentives: string | number;
  payment_timing: 'beginning' | 'end';
  payment_day_of_month: string | number;
  transfer_ownership: boolean;
  purchase_option: boolean;
  purchase_option_price: string | number;
  asset_fair_value: string | number;
  asset_market_value: string | number;
  asset_economic_life_months: string | number;
  classification_override_reason: string;
  specialized_asset: boolean;
  residual_value_guarantee: string | number;
  rvg_probable_amount: string | number;
  auto_classified: boolean;
  branch_id: string;
  fixed_asset_type_id: string;
  implicit_rate: string | number;
  implicit_rate_readily_determinable: boolean;
  risk_free_rate: string | number;
  risk_free_rate_source: string;
  risk_free_rate_date: string;
  discount_rate_method: string;
  discount_rate: string | number;
  rate_source: string;
  rate_date: string;
  risk_free_policy_election_id: string;
  accounting_treatment: 'recognized' | 'short_term_exemption';
  short_term_policy_election_id: string;
  lease_component_amount: string | number;
  nonlease_component_amount: string | number;
  component_policy: 'combined' | 'separate' | 'not_applicable';
  component_policy_election_id: string;
  related_party: boolean;
  related_party_name: string;
  purchase_option_reasonably_certain: boolean;
  renewal_months_reasonably_certain: string | number;
  renewal_payment_amount: string | number;
  termination_option_month: string | number;
  termination_option_reasonably_certain: boolean;
  termination_penalty_amount: string | number;
  prepaid_lease_payments: string | number;
  status: Lease['status'];
}

export interface LeaseFormProps {
  onClose: () => void;
  onSuccess: () => void;
  lease?: Lease;
  userId: string;
  selectedCompanyId?: string | null;
  canCreateBranch?: boolean;
}

import type { PaymentTranche } from '../utils/leaseCalculations';

export interface Company {
  id: string;
  user_id: string;
  company_name: string;
  company_code: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  tax_id: string | null;
  industry: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lease {
  id: string;
  user_id: string;
  organization_id: string;
  branch_id?: string | null;
  company_id?: string | null;
  lease_name: string;
  lease_description: string;
  lessor_name: string;
  lessor_type: 'corporate' | 'individual' | 'government' | 'financial_institution' | 'other';
  lease_start_date: string;
  lease_end_date: string;
  lease_term_months: number;
  payment_amount: number;
  payment_frequency: string;
  incremental_borrowing_rate: number;
  lease_classification: 'operating' | 'finance';
  initial_direct_costs: number;
  lease_incentives: number;
  rou_asset: number | null;
  lease_liability: number | null;
  status: 'active' | 'terminated' | 'expired' | 'cancelled' | 'pending';
  payment_timing: 'beginning' | 'end';
  payment_day_of_month?: number | null;
  transfer_ownership: boolean;
  purchase_option: boolean;
  purchase_option_price: number;
  asset_fair_value: number;
  asset_market_value: number;
  asset_economic_life_months: number;
  classification_override_reason?: string | null;
  specialized_asset: boolean;
  residual_value_guarantee: number;
  rvg_probable_amount?: number;
  auto_classified: boolean;
  fixed_asset_type_id?: string | null;
  implicit_rate?: number | null;
  implicit_rate_readily_determinable?: boolean;
  risk_free_rate?: number | null;
  risk_free_rate_source?: string | null;
  risk_free_rate_date?: string | null;
  discount_rate_method?: string | null;
  discount_rate?: number | null;
  rate_source?: string | null;
  rate_date?: string | null;
  risk_free_policy_election_id?: string | null;
  accounting_treatment?: 'recognized' | 'short_term_exemption';
  short_term_policy_election_id?: string | null;
  paymentTranches?: PaymentTranche[];
  lease_component_amount?: number;
  nonlease_component_amount?: number;
  component_policy?: 'combined' | 'separate' | 'not_applicable';
  component_policy_election_id?: string | null;
  related_party?: boolean;
  related_party_name?: string | null;
  purchase_option_reasonably_certain?: boolean;
  renewal_months_reasonably_certain?: number;
  renewal_payment_amount?: number | null;
  termination_option_month?: number | null;
  termination_option_reasonably_certain?: boolean;
  termination_penalty_amount?: number;
  prepaid_lease_payments?: number;
  created_at: string;
  updated_at: string;
  is_complete?: boolean;
  modifications?: ContractModification[];
  currentBalances?: { currentRouAsset: number; currentLiability: number; balanceStatus?: 'not_started' | 'active' | 'ended' | 'no_schedule' };
}

export interface FixedAssetType {
  id: string;
  user_id: string;
  type_name: string;
  type_code: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContractModification {
  id: string;
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  old_monthly_payment: number;
  new_monthly_payment: number;
  old_lease_term: number;
  new_lease_term: number;
  status: string;
}

export interface LeasePayment {
  id: string;
  lease_id: string;
  payment_date: string;
  payment_amount: number;
  payment_type: string;
  created_at: string;
}

export interface AmortizationSchedule {
  id?: string;
  lease_id?: string;
  period_number: number;
  period_date: string;
  beginning_liability: number;
  payment_amount: number;
  interest_expense: number;
  principal_reduction: number;
  ending_liability: number;
  rou_asset_balance: number;
  depreciation_expense: number;
  short_term_lease_cost?: number;
  created_at?: string;
}

export interface JournalEntry {
  id: string;
  lease_id: string;
  amortization_id?: string | null;
  entry_date: string;
  entry_type: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  created_at: string;
}

export interface LeaseModification {
  id: string;
  lease_id: string;
  modification_date: string;
  modification_type: string;
  description: string;
  old_value: string;
  new_value: string;
  created_at: string;
}

export interface LeaseReport {
  totalLeases: number;
  activeLeases: number;
  financeLeases: number;
  operatingLeases: number;
  shortTermExemptLeases?: number;
  totalRouAsset: number;
  totalLiability: number;
  totalMonthlyPayments: number;
  avgBorrowingRate: number;
}

export interface Branch {
  id: string;
  user_id: string;
  branch_name: string;
  branch_code: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  manager_name: string;
  contact_email: string;
  contact_phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

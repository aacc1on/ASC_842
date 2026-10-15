import { useState } from 'react';
import type { Lease } from '../types/lease';
import type { LeaseFormData, PaymentTrancheRow, ClassificationResult } from '../components/lease-form/types';
import { toYMD } from '../utils/formatting';

function todayISO(): string {
  return toYMD(new Date());
}

function addMonthsISO(start: string, months: number): string {
  const d = start ? new Date(start) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return toYMD(d);
}

function buildInitialFormData(lease?: Lease): LeaseFormData {
  if (lease) {
    return {
      lease_name: lease.lease_name ?? '',
      lease_description: lease.lease_description ?? '',
      lessor_name: lease.lessor_name ?? '',
      lessor_type: lease.lessor_type ?? 'corporate',
      lease_start_date: lease.lease_start_date ?? '',
      lease_end_date: lease.lease_end_date ?? '',
      lease_term_months: lease.lease_term_months ?? '',
      payment_amount: lease.payment_amount ?? '',
      payment_frequency: lease.payment_frequency ?? 'monthly',
      incremental_borrowing_rate: lease.incremental_borrowing_rate ?? '',
      lease_classification: lease.lease_classification ?? 'operating',
      initial_direct_costs: lease.initial_direct_costs ?? '',
      lease_incentives: lease.lease_incentives ?? '',
      payment_timing: lease.payment_timing ?? 'beginning',
      payment_day_of_month: lease.payment_day_of_month ?? '',
      transfer_ownership: lease.transfer_ownership ?? false,
      purchase_option: lease.purchase_option ?? false,
      purchase_option_price: lease.purchase_option_price ?? '',
      asset_fair_value: lease.asset_fair_value ?? '',
      asset_market_value: lease.asset_market_value ?? '',
      asset_economic_life_months: lease.asset_economic_life_months ?? '',
      classification_override_reason: lease.classification_override_reason ?? '',
      specialized_asset: lease.specialized_asset ?? false,
      residual_value_guarantee: lease.residual_value_guarantee ?? '',
      rvg_probable_amount: lease.rvg_probable_amount ?? '',
      auto_classified: lease.auto_classified ?? false,
      branch_id: lease.branch_id ?? '',
      fixed_asset_type_id: lease.fixed_asset_type_id ?? '',
      implicit_rate: lease.implicit_rate ?? '',
      implicit_rate_readily_determinable: lease.implicit_rate_readily_determinable ?? false,
      risk_free_rate: lease.risk_free_rate ?? '',
      risk_free_rate_source: lease.risk_free_rate_source ?? '',
      risk_free_rate_date: lease.risk_free_rate_date ?? '',
      discount_rate_method: lease.discount_rate_method ?? 'ibr',
      discount_rate: lease.discount_rate ?? '',
      rate_source: lease.rate_source ?? '',
      rate_date: lease.rate_date ?? '',
      risk_free_policy_election_id: lease.risk_free_policy_election_id ?? '',
      accounting_treatment: lease.accounting_treatment ?? 'recognized',
      short_term_policy_election_id: lease.short_term_policy_election_id ?? '',
      lease_component_amount: lease.lease_component_amount || lease.payment_amount || '',
      nonlease_component_amount: lease.nonlease_component_amount ?? '',
      component_policy: lease.component_policy ?? 'not_applicable',
      component_policy_election_id: lease.component_policy_election_id ?? '',
      related_party: lease.related_party ?? false,
      related_party_name: lease.related_party_name ?? '',
      purchase_option_reasonably_certain: lease.purchase_option_reasonably_certain ?? false,
      renewal_months_reasonably_certain: lease.renewal_months_reasonably_certain ?? 0,
      renewal_payment_amount: lease.renewal_payment_amount ?? '',
      termination_option_month: lease.termination_option_month ?? '',
      termination_option_reasonably_certain: lease.termination_option_reasonably_certain ?? false,
      termination_penalty_amount: lease.termination_penalty_amount ?? 0,
      prepaid_lease_payments: lease.prepaid_lease_payments ?? 0,
      status: lease.status ?? 'active',
    };
  }

  const start = todayISO();
  return {
    lease_name: '',
    lease_description: '',
    lessor_name: '',
    lessor_type: 'corporate',
    lease_start_date: start,
    lease_end_date: addMonthsISO(start, 12),
    lease_term_months: '',
    payment_amount: '',
    payment_frequency: 'monthly',
    incremental_borrowing_rate: '',
    lease_classification: 'operating',
    initial_direct_costs: '',
    lease_incentives: '',
    payment_timing: 'beginning',
    payment_day_of_month: '',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: '',
    asset_fair_value: '',
    asset_market_value: '',
    asset_economic_life_months: '',
    classification_override_reason: '',
    specialized_asset: false,
    residual_value_guarantee: '',
    rvg_probable_amount: '',
    auto_classified: false,
    branch_id: '',
    fixed_asset_type_id: '',
    implicit_rate: '',
    implicit_rate_readily_determinable: false,
    risk_free_rate: '',
    risk_free_rate_source: '',
    risk_free_rate_date: '',
    discount_rate_method: 'ibr',
    discount_rate: '',
    rate_source: '',
    rate_date: '',
    risk_free_policy_election_id: '',
    accounting_treatment: 'recognized',
    short_term_policy_election_id: '',
    lease_component_amount: '',
    nonlease_component_amount: '',
    component_policy: 'not_applicable',
    component_policy_election_id: '',
    related_party: false,
    related_party_name: '',
    purchase_option_reasonably_certain: false,
    renewal_months_reasonably_certain: 0,
    renewal_payment_amount: '',
    termination_option_month: '',
    termination_option_reasonably_certain: false,
    termination_penalty_amount: 0,
    prepaid_lease_payments: 0,
    status: 'active',
  };
}

export interface UseLeaseFormStateResult {
  formData: LeaseFormData;
  setFormData: React.Dispatch<React.SetStateAction<LeaseFormData>>;
  useVariablePayments: boolean;
  setUseVariablePayments: React.Dispatch<React.SetStateAction<boolean>>;
  paymentTranches: PaymentTrancheRow[];
  setPaymentTranches: React.Dispatch<React.SetStateAction<PaymentTrancheRow[]>>;
  classificationResult: ClassificationResult | null;
  setClassificationResult: React.Dispatch<React.SetStateAction<ClassificationResult | null>>;
  showClassificationWizard: boolean;
  setShowClassificationWizard: React.Dispatch<React.SetStateAction<boolean>>;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  leaseNameError: string;
  setLeaseNameError: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Owns all the mutable form state for LeaseForm: the field values, the variable
 * payment tranches, the classification wizard result/banner, and the generic
 * error + loading flags. The orchestrator spreads these into the actions hook.
 */
export function useLeaseFormState(lease?: Lease): UseLeaseFormStateResult {
  const [formData, setFormData] = useState<LeaseFormData>(() => buildInitialFormData(lease));
  const [useVariablePayments, setUseVariablePayments] = useState(false);
  const [paymentTranches, setPaymentTranches] = useState<PaymentTrancheRow[]>([]);
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  const [showClassificationWizard, setShowClassificationWizard] = useState(false);
  const [error, setError] = useState('');
  const [leaseNameError, setLeaseNameError] = useState('');
  const [loading, setLoading] = useState(false);

  return {
    formData,
    setFormData,
    useVariablePayments,
    setUseVariablePayments,
    paymentTranches,
    setPaymentTranches,
    classificationResult,
    setClassificationResult,
    showClassificationWizard,
    setShowClassificationWizard,
    error,
    setError,
    leaseNameError,
    setLeaseNameError,
    loading,
    setLoading,
  };
}

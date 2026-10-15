import { describe, it, expect } from 'vitest';
import { runClassification, calculateTermMonths } from '../components/lease-form/leaseFormCalculations';
import type { LeaseFormData, PaymentTrancheRow } from '../components/lease-form/types';

const baseFormData: LeaseFormData = {
  lease_name: 'Test',
  lease_description: '',
  lessor_name: 'Test Lessor',
  lessor_type: 'corporate',
  lease_start_date: '2026-01-01',
  lease_end_date: '2029-01-01',
  lease_term_months: 36,
  payment_amount: '1000',
  payment_frequency: 'monthly',
  incremental_borrowing_rate: '5',
  lease_classification: 'operating',
  initial_direct_costs: '0',
  lease_incentives: '0',
  payment_timing: 'beginning',
  payment_day_of_month: '',
  transfer_ownership: false,
  purchase_option: false,
  purchase_option_price: '0',
  asset_fair_value: '',
  asset_market_value: '35000',
  asset_economic_life_months: '60',
  classification_override_reason: '',
  specialized_asset: false,
  residual_value_guarantee: '0',
  rvg_probable_amount: '0',
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
  status: 'active',
  related_party: false,
  related_party_name: '',
  purchase_option_reasonably_certain: false,
  renewal_months_reasonably_certain: 0,
  renewal_payment_amount: '',
  termination_option_month: '',
  termination_option_reasonably_certain: false,
  termination_penalty_amount: 0,
  prepaid_lease_payments: 0,
};

const noTranches: PaymentTrancheRow[] = [];

describe('runClassification (Classification Wizard logic)', () => {
  it('transfer of ownership gives Finance even with a small PV', () => {
    const data = { ...baseFormData, transfer_ownership: true, asset_market_value: '50000' };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('finance');
    expect(result.reasons.some((r) => r.toLowerCase().includes('ownership'))).toBe(true);
  });

  it('purchase option gives Finance (bargain purchase)', () => {
    const data = {
      ...baseFormData,
      purchase_option: true,
      purchase_option_reasonably_certain: true,
      purchase_option_price: '1000',
      asset_market_value: '50000',
    };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('finance');
    expect(result.reasons.some((r) => r.toLowerCase().includes('purchase'))).toBe(true);
  });

  it('specialized asset gives Finance', () => {
    const data = { ...baseFormData, specialized_asset: true, asset_market_value: '50000' };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('finance');
    expect(result.reasons.some((r) => r.toLowerCase().includes('no alternative use'))).toBe(true);
  });

  it('36-month term with 60-month life and PV 93.9% of fair value gives Finance', () => {
    // 36 months, payment 1000, rate 5%, beginning → PV ~32871
    // fair value 35000 → ratio ~93.9% → finance
    const data = {
      ...baseFormData,
      asset_market_value: '35000',
      asset_economic_life_months: '60',
    };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('finance');
    expect(result.reasons.some((r) => r.includes('90%'))).toBe(true);
  });

  it('same with fair value 50000 gives Operating', () => {
    const data = {
      ...baseFormData,
      asset_market_value: '50000',
      asset_economic_life_months: '60',
    };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('operating');
  });

  it('validation: no dates gives error via termMonths=0', () => {
    const data = { ...baseFormData, lease_start_date: '', lease_end_date: '', lease_term_months: '' };
    expect(calculateTermMonths(data)).toBe(0);
    // runClassification still runs but determineLeaseClassification with termMonths=0
    // won't trigger majorPartOfLife; with asset value 35000 and PV=0 it won't trigger substantiallyAllValue
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('operating');
  });

  it('ignores the entered Lease Fair Value and tests the PV of lease payments', () => {
    const data = { ...baseFormData, asset_fair_value: '46600', asset_market_value: '50000', asset_economic_life_months: '120' };
    const result = runClassification(data, false, noTranches);
    expect(result.classification).toBe('operating');
    expect(result.presentValue).toBe(33504.73);
  });

  it('Vehicle 14: PV is the discounted payments at commencement, not the undiscounted total', () => {
    const data = {
      ...baseFormData,
      lease_start_date: '2023-01-04',
      lease_end_date: '2027-11-04',
      lease_term_months: 58,
      payment_amount: '260',
      incremental_borrowing_rate: '6',
      asset_fair_value: '15080',
      asset_market_value: '26800',
    };
    expect(runClassification(data, false, noTranches).presentValue).toBe(13127.48);
  });

  it('includes prepaid payments in the computed lease value when none is entered', () => {
    const base = { ...baseFormData, asset_market_value: '40000', asset_economic_life_months: '120' };
    expect(runClassification(base, false, noTranches).classification).toBe('operating');
    expect(runClassification({ ...base, prepaid_lease_payments: 5000 }, false, noTranches).classification).toBe('finance');
  });
});

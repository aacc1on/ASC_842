import { describe, it, expect } from 'vitest';
import type { LeaseFormData } from '../components/lease-form/types';
import { NO_DISCOUNT_RATE_CONTEXT } from './discountRate';
import {
  POSTED_LEASE_MESSAGE,
  buildAmortizationRows,
  buildDescriptiveLeasePayload,
  buildLeasePayload,
  buildPaymentScheduleRows,
  buildRecognitionRows,
  computeSubmittedShortTermCost,
  num,
  toLeaseSaveErrorMessage,
  tranchesToRows,
} from './leaseSaveRows';

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

const tranches = [
  { id: 'a', fromMonth: 13, toMonth: 36, paymentAmount: 1100 },
  { id: 'b', fromMonth: 1, toMonth: 12, paymentAmount: '1000' as unknown as number },
];

describe('leaseSaveRows', () => {
  it('num and tranchesToRows normalise inputs', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num('abc')).toBe(0);
    expect(tranchesToRows([{ id: 'x', from_month: 13, to_month: 24, payment_amount: 5 }, { id: 'y', from_month: 1, to_month: 12, payment_amount: 4 }]).map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('buildPaymentScheduleRows only emits rows for variable payments', () => {
    expect(buildPaymentScheduleRows(false, tranches)).toEqual([]);
    expect(buildPaymentScheduleRows(true, tranches)).toEqual([
      { from_month: 13, to_month: 36, payment_amount: 1100 },
      { from_month: 1, to_month: 12, payment_amount: 1000 },
    ]);
  });

  it('buildAmortizationRows: short-term leases get cost-only rows, recognised leases amortise to zero', () => {
    const common = { formData: baseFormData, useVariablePayments: false, discountRateCtx: NO_DISCOUNT_RATE_CONTEXT, measurementPayment: 1000, effectiveTranches: [] };
    const st = buildAmortizationRows({ ...common, isShortTermExempt: true, shortTermCost: 950 });
    expect(st).toHaveLength(36);
    expect(st[0]).toMatchObject({ period_number: 1, period_date: '2026-01-01', payment_amount: 1000, ending_liability: 0, short_term_lease_cost: 950 });
    const rec = buildAmortizationRows({ ...common, isShortTermExempt: false, shortTermCost: 0 });
    expect(rec).toHaveLength(36);
    expect(rec[rec.length - 1].ending_liability).toBe(0);
    expect(rec[0].beginning_liability).toBeGreaterThan(0);
  });

  it('buildRecognitionRows posts liability, IDC, incentives, prepaid and any ROU adjustment', () => {
    const fd = { ...baseFormData, initial_direct_costs: '500', lease_incentives: '200', prepaid_lease_payments: 100 };
    const rows = buildRecognitionRows(fd, 'Test', 10000, 10500, false);
    expect(rows.map((r) => [r.account_debited, r.account_credited, r.amount])).toEqual([
      ['Right-of-Use Asset', 'Lease Liability', 10000],
      ['Right-of-Use Asset', 'Cash / Accounts Payable', 500],
      ['Cash / Lease Incentive Receivable', 'Right-of-Use Asset', 200],
      ['Right-of-Use Asset', 'Prepaid Rent (Cash)', 100],
      ['Right-of-Use Asset', 'Lease Liability', 100],
    ]);
    expect(buildRecognitionRows(fd, 'Test', 10000, 10500, true)).toEqual([]);
  });

  it('computeSubmittedShortTermCost spreads payments plus a certain penalty over the term', () => {
    const fd = { ...baseFormData, lease_end_date: '2026-12-01', termination_option_reasonably_certain: true, termination_penalty_amount: 1100 };
    expect(computeSubmittedShortTermCost(fd, 11, 1000, false, [])).toBe(1100);
  });

  it('buildLeasePayload maps form values and measurement results', () => {
    const payload = buildLeasePayload({
      userId: 'u1', formCompanyId: 'c1', formData: { ...baseFormData, lease_name: ' Office ' }, discountRateCtx: NO_DISCOUNT_RATE_CONTEXT,
      overrideEndDate: '2029-01-01', termMonths: 36, measurementPayment: 1000, selectedRate: { rate: 5, method: 'ibr', reason: 'IBR' },
      isShortTermExempt: true, shortTermPolicyElectionId: 'pe1', leaseComponentAmount: 1000, nonleaseAmount: 0,
      componentPolicy: 'not_applicable', componentPolicyElectionId: null, metrics: { rouAsset: 0, leaseLiability: 0 },
    });
    expect(payload).toMatchObject({
      user_id: 'u1', company_id: 'c1', lease_name: 'Office', lease_term_months: 36, accounting_treatment: 'short_term_exemption',
      short_term_policy_election_id: 'pe1', discount_rate: 5, rate_source: 'IBR', implicit_rate: null, branch_id: null,
    });
  });

  it('descriptive payload and error messages', () => {
    expect(buildDescriptiveLeasePayload('l1', { ...baseFormData, related_party: true, related_party_name: ' Kin ' })).toMatchObject({ id: 'l1', related_party_name: 'Kin' });
    expect(toLeaseSaveErrorMessage(new Error('lease has posted periods'))).toBe(POSTED_LEASE_MESSAGE);
    expect(toLeaseSaveErrorMessage(new Error('boom'))).not.toBe(POSTED_LEASE_MESSAGE);
  });
});

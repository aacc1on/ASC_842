// Generates amortization schedules + journal entries for the staging demo leases through the same calculation
// code and server functions the lease form and Journal tab use (save_lease, refresh_lease_journal_entries).
import type { Lease, AmortizationSchedule } from '../../src/types/lease';
import type { LeaseFormData } from '../../src/components/lease-form/types';
import {
  calculateNoncancellableTermMonths,
  calculateSubmittedLeaseMetrics,
  calculateTermMonths,
  getSelectedDiscountRate,
} from '../../src/components/lease-form/leaseFormCalculations';
import { NO_DISCOUNT_RATE_CONTEXT } from '../../src/utils/discountRate';
import { qualifiesForShortTermExemption } from '../../src/utils/shortTermLease';
import { determineComponentPolicy, measurementPaymentPerPeriod } from '../../src/utils/leaseComponents';
import {
  buildAmortizationRows,
  buildLeasePayload,
  buildPaymentScheduleRows,
  buildRecognitionRows,
  computeSubmittedShortTermCost,
  num,
} from '../../src/utils/leaseSaveRows';
import { buildLeaseJournalEntries } from '../../src/utils/leaseJournalBuild';

export interface DemoLeaseStore {
  listLeases(): Promise<Lease[]>;
  getLease(leaseId: string): Promise<Lease>;
  listSchedule(leaseId: string): Promise<AmortizationSchedule[]>;
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface DemoLeaseResult {
  lease: string;
  periods: number;
  journalEntries: number;
}

const FORM_DEFAULTS: Partial<LeaseFormData> = {
  lessor_type: 'corporate',
  payment_frequency: 'monthly',
  payment_timing: 'beginning',
  discount_rate_method: 'ibr',
  accounting_treatment: 'recognized',
  component_policy: 'not_applicable',
  renewal_months_reasonably_certain: 0,
  termination_penalty_amount: 0,
  prepaid_lease_payments: 0,
  status: 'active',
};

// Same shape the lease form loads for an existing lease: nulls become '' (or the form's default).
function toFormData(lease: Lease): LeaseFormData {
  const form: Record<string, unknown> = { ...FORM_DEFAULTS };
  for (const [key, value] of Object.entries(lease)) {
    if (value !== null && value !== undefined) form[key] = value;
    else if (!(key in form)) form[key] = '';
  }
  form.lease_component_amount = lease.lease_component_amount || lease.payment_amount || '';
  for (const key of ['transfer_ownership', 'purchase_option', 'purchase_option_reasonably_certain', 'related_party',
    'specialized_asset', 'auto_classified', 'implicit_rate_readily_determinable', 'termination_option_reasonably_certain']) {
    if (form[key] === '') form[key] = false;
  }
  return form as unknown as LeaseFormData;
}

function accountingEndDate(formData: LeaseFormData, termMonths: number): string {
  const noncancellable = calculateNoncancellableTermMonths(formData);
  if (termMonths === noncancellable && !formData.termination_option_reasonably_certain) return String(formData.lease_end_date);
  const [y, m, d] = String(formData.lease_start_date).split('T')[0].split('-').map(Number);
  const end = new Date(y, (m || 1) - 1 + termMonths, d || 1);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

async function saveLease(store: DemoLeaseStore, lease: Lease): Promise<void> {
  const formData = toFormData(lease);
  const companyId = lease.company_id ?? '';
  const termMonths = calculateTermMonths(formData);
  if (termMonths <= 0) throw new Error(`${lease.lease_name}: lease term must be greater than zero`);

  const stl = qualifiesForShortTermExemption({
    leaseTermMonths: termMonths,
    purchaseOption: formData.purchase_option,
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
    companyId,
    fixedAssetTypeId: formData.fixed_asset_type_id,
    leaseStartDate: formData.lease_start_date,
    shortTermElections: [],
  });
  const nonleaseAmount = num(formData.nonlease_component_amount);
  const leaseComponentAmount = num(formData.lease_component_amount) || num(formData.payment_amount);
  const component = determineComponentPolicy({
    nonleaseAmount,
    companyId,
    fixedAssetTypeId: formData.fixed_asset_type_id,
    leaseStartDate: formData.lease_start_date,
    elections: [],
  });
  const measurementPayment = measurementPaymentPerPeriod(leaseComponentAmount, nonleaseAmount, component.policy);
  const ctx = NO_DISCOUNT_RATE_CONTEXT;
  const metrics = stl.applied
    ? { leaseLiability: 0, rouAsset: 0, presentValueOfPayments: 0 }
    : calculateSubmittedLeaseMetrics({ ...formData, payment_amount: measurementPayment }, false, [], ctx);
  const shortTermCost = stl.applied ? computeSubmittedShortTermCost(formData, termMonths, measurementPayment, false, []) : 0;

  const leasePayload = buildLeasePayload({
    userId: lease.user_id,
    formCompanyId: companyId,
    formData,
    discountRateCtx: ctx,
    overrideEndDate: accountingEndDate(formData, termMonths),
    termMonths,
    measurementPayment,
    selectedRate: getSelectedDiscountRate(formData, ctx),
    isShortTermExempt: stl.applied,
    shortTermPolicyElectionId: stl.policyElectionId,
    leaseComponentAmount,
    nonleaseAmount,
    componentPolicy: component.policy,
    componentPolicyElectionId: component.policyElectionId,
    metrics,
  });
  leasePayload.id = lease.id;

  await store.rpc('save_lease', {
    p_lease: leasePayload,
    p_payment_schedule: buildPaymentScheduleRows(false, []),
    p_amortization: buildAmortizationRows({
      formData,
      useVariablePayments: false,
      discountRateCtx: ctx,
      isShortTermExempt: stl.applied,
      shortTermCost,
      measurementPayment,
      effectiveTranches: [],
    }),
    p_recognition: buildRecognitionRows(formData, formData.lease_name.trim(), metrics.leaseLiability, metrics.rouAsset, stl.applied),
  });
}

export async function generateDemoSchedules(store: DemoLeaseStore): Promise<DemoLeaseResult[]> {
  const leases = await store.listLeases();
  if (leases.length === 0) throw new Error('No demo leases found for the demo organization');
  const results: DemoLeaseResult[] = [];
  for (const original of leases) {
    await saveLease(store, original);
    const lease = await store.getLease(original.id);
    const schedule = await store.listSchedule(lease.id);
    if (schedule.length === 0) throw new Error(`${lease.lease_name}: save_lease stored no schedule rows`);
    const entries = buildLeaseJournalEntries(lease, schedule, []);
    await store.rpc('refresh_lease_journal_entries', { p_lease_id: lease.id, p_entries: entries });
    results.push({ lease: lease.lease_name, periods: schedule.length, journalEntries: entries.length });
  }
  return results;
}

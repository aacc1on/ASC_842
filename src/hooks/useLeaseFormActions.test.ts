import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFakeSupabase, RpcError } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import type { LeaseFormData, PaymentTrancheRow, ClassificationResult } from '../components/lease-form/types';
import { useLeaseFormActions, POSTED_LEASE_MESSAGE } from './useLeaseFormActions';
import { DUPLICATE_NAME_MESSAGE } from '../utils/errors';
import {
  FINANCE_INPUTS_REQUIRED_MESSAGE,
  NO_FINANCE_CRITERIA_MESSAGE,
} from '../components/lease-form/leaseFormCalculations';
import { reportCriticalError } from '../utils/errorReporter';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));
vi.mock('../utils/errorReporter', () => ({ reportCriticalError: vi.fn() }));

type Fake = ReturnType<typeof createFakeSupabase>;
type Handler = (args: Record<string, unknown>, tables: Tables) => unknown;

let tables: Tables;
let fake: Fake;

/** The fake has no `.ilike`; add a case-insensitive equality filter on top of it. */
function setup(rpc: Record<string, Handler> = {}) {
  fake = createFakeSupabase(tables, {
    userId: 'user-1',
    rpc: { save_lease: () => 'new-lease-id', set_classification_override: () => null, ...rpc },
  });
  h.client = {
    ...fake,
    from: (table: string) => {
      const q = fake.from(table) as unknown as { filters: ((r: Row) => boolean)[]; ilike?: unknown };
      q.ilike = (c: string, v: string) => {
        q.filters.push((r) => String(r[c] ?? '').toLowerCase() === v.toLowerCase());
        return q;
      };
      return q;
    },
  };
}

function makeFormData(overrides: Partial<LeaseFormData> = {}): LeaseFormData {
  return {
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-12-31',
    lease_term_months: 12,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 5,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    payment_timing: 'beginning',
    payment_day_of_month: '',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: '',
    asset_fair_value: 50000,
    asset_market_value: 50000,
    asset_economic_life_months: 240,
    classification_override_reason: '',
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: '',
    auto_classified: false,
    branch_id: '',
    fixed_asset_type_id: 'fat-1',
    implicit_rate: '',
    implicit_rate_readily_determinable: false,
    risk_free_rate: '',
    risk_free_rate_source: '',
    risk_free_rate_date: '',
    discount_rate_method: 'incremental',
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
    renewal_months_reasonably_certain: '',
    renewal_payment_amount: '',
    termination_option_month: '',
    termination_option_reasonably_certain: false,
    termination_penalty_amount: '',
    prepaid_lease_payments: '',
    status: 'active',
    ...overrides,
  };
}

type Args = Parameters<typeof useLeaseFormActions>[0];

function makeArgs(overrides: Partial<Args> = {}): Args {
  return {
    lease: undefined,
    userId: 'user-1',
    formCompanyId: 'company-1',
    formData: makeFormData(),
    setFormData: vi.fn(),
    useVariablePayments: false,
    setUseVariablePayments: vi.fn(),
    paymentTranches: [] as PaymentTrancheRow[],
    setPaymentTranches: vi.fn(),
    classificationResult: null as ClassificationResult | null,
    setClassificationResult: vi.fn(),
    setShowClassificationWizard: vi.fn(),
    error: '',
    setError: vi.fn(),
    leaseNameError: '',
    setLeaseNameError: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    branches: [],
    setBranches: vi.fn(),
    fixedAssetTypes: [],
    setFixedAssetTypes: vi.fn(),
    newBranchName: '',
    setNewBranchName: vi.fn(),
    newBranchCode: '',
    setNewBranchCode: vi.fn(),
    setShowNewBranchForm: vi.fn(),
    newAssetTypeName: '',
    setNewAssetTypeName: vi.fn(),
    newAssetTypeCode: '',
    setNewAssetTypeCode: vi.fn(),
    setShowNewAssetTypeForm: vi.fn(),
    onSuccess: vi.fn(),
    discountRateCtx: { riskFreeElectionApproved: false, entityEligibleForRiskFree: false, riskFreePolicyElectionId: null },
    shortTermCtx: { shortTermElectionApproved: false, shortTermElectionId: null, shortTermElections: [] },
    combineCtx: { combineElectionApproved: false, combineElectionId: null, combineElections: [] },
    ...overrides,
  };
}

const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';
const evt = { preventDefault: () => undefined } as unknown as React.FormEvent;

async function submit(args: Args) {
  const { result } = renderHook(() => useLeaseFormActions(args));
  await act(async () => {
    await result.current.handleSubmit(evt);
  });
  return result;
}

const lastError = (args: Args) => {
  const calls = (args.setError as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0];
};
const saveCalls = () => fake.calls.filter((c) => c.fn === 'save_lease');
const saveArgs = (i = 0) => saveCalls()[i].args as {
  p_lease: Record<string, unknown>;
  p_payment_schedule: unknown[];
  p_amortization: unknown[];
  p_recognition: unknown[];
};

beforeEach(() => {
  vi.mocked(reportCriticalError).mockClear();
  tables = {
    leases: [
      { id: 'l-dup', company_id: 'company-1', lease_name: 'Existing HQ', status: 'active' },
      { id: 'l-other-co', company_id: 'company-2', lease_name: 'Other Co Lease', status: 'active' },
      { id: 'l-terminated', company_id: 'company-1', lease_name: 'Old Depot', status: 'terminated' },
    ],
    lease_payment_schedules: [],
  };
  setup();
});

describe('useLeaseFormActions.handleSubmit — validation', () => {
  const cases: [string, Partial<Args>, string][] = [
    ['no company', { formCompanyId: '' }, 'Please select a company.'],
    ['no asset class', { formData: makeFormData({ fixed_asset_type_id: '' }) }, 'Select an asset class (Fixed Asset Type) before saving.'],
    ['blank lease name', { formData: makeFormData({ lease_name: '   ' }) }, 'Lease name is required.'],
    ['blank lessor', { formData: makeFormData({ lessor_name: ' ' }) }, 'Lessor name is required.'],
    ['missing end date', { formData: makeFormData({ lease_end_date: '' }) }, 'Lease start and end dates are required.'],
    ['missing start date', { formData: makeFormData({ lease_start_date: '' }) }, 'Lease start and end dates are required.'],
    ['end before start', { formData: makeFormData({ lease_end_date: '2025-06-01' }) }, 'Lease end date must be after the start date.'],
    ['zero payment', { formData: makeFormData({ payment_amount: 0 }) }, 'Payment amount must be greater than zero for a recognized lease.'],
  ];

  it.each(cases)('%s blocks save with a message', async (_name, overrides, message) => {
    const args = makeArgs(overrides);
    await submit(args);
    expect(args.setError).toHaveBeenCalledWith('');
    expect(lastError(args)).toBe(message);
    expect(fake.calls).toHaveLength(0);
    expect(args.setLoading).not.toHaveBeenCalled();
    expect(args.onSuccess).not.toHaveBeenCalled();
  });

  it('clears any previous lease-name error once the name is present', async () => {
    const args = makeArgs({ formData: makeFormData({ lessor_name: '' }) });
    await submit(args);
    expect(args.setLeaseNameError).toHaveBeenCalledWith('');
  });

  it('rejects a non-computable term (unparseable dates, no explicit term)', async () => {
    const args = makeArgs({
      formData: makeFormData({ lease_term_months: '', lease_start_date: 'not-a-date', lease_end_date: 'also-bad' }),
    });
    await submit(args);
    expect(lastError(args)).toBe('Lease term must be greater than zero.');
    expect(saveCalls()).toHaveLength(0);
  });

  it('finance classification without fair value / useful life requires inputs', async () => {
    const args = makeArgs({
      formData: makeFormData({ lease_classification: 'finance', asset_market_value: '', asset_economic_life_months: '' }),
    });
    await submit(args);
    expect(lastError(args)).toBe(FINANCE_INPUTS_REQUIRED_MESSAGE);
    expect(saveCalls()).toHaveLength(0);
  });

  it('finance with no criteria met requires an override reason', async () => {
    const args = makeArgs({ formData: makeFormData({ lease_classification: 'finance' }) });
    await submit(args);
    expect(lastError(args)).toBe(`${NO_FINANCE_CRITERIA_MESSAGE} Enter an override reason to keep Finance.`);
    expect(saveCalls()).toHaveLength(0);
  });
});

describe('useLeaseFormActions.handleSubmit — new lease', () => {
  it('saves through a single save_lease RPC and calls onSuccess', async () => {
    const args = makeArgs();
    await submit(args);
    expect(saveCalls()).toHaveLength(1);
    const a = saveArgs();
    expect(a.p_lease.lease_name).toBe('Test Lease');
    expect(a.p_lease.company_id).toBe('company-1');
    expect(a.p_lease.id).toBeUndefined();
    expect(a.p_amortization.length).toBeGreaterThan(0);
    expect(a.p_recognition.length).toBeGreaterThan(0);
    expect(args.setLoading).toHaveBeenNthCalledWith(1, true);
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
    expect(args.onSuccess).toHaveBeenCalledTimes(1);
    // No override reason to sync on a fresh operating lease
    expect(fake.calls.some((c) => c.fn === 'set_classification_override')).toBe(false);
    expect(reportCriticalError).not.toHaveBeenCalled();
  });

  it('pre-checks duplicate names case-insensitively within the same company', async () => {
    const args = makeArgs({ formData: makeFormData({ lease_name: '  existing hq ' }) });
    await submit(args);
    expect(args.setLeaseNameError).toHaveBeenLastCalledWith(DUPLICATE_NAME_MESSAGE);
    expect(saveCalls()).toHaveLength(0);
    expect(args.setLoading).not.toHaveBeenCalled();
  });

  it('does not treat a same-named lease in another company as a duplicate (company scoping)', async () => {
    const args = makeArgs({ formData: makeFormData({ lease_name: 'Other Co Lease' }) });
    await submit(args);
    expect(saveCalls()).toHaveLength(1);
    expect(args.onSuccess).toHaveBeenCalled();
  });

  it('ignores non-active leases when checking for duplicates', async () => {
    const args = makeArgs({ formData: makeFormData({ lease_name: 'Old Depot' }) });
    await submit(args);
    expect(saveCalls()).toHaveLength(1);
  });

  it('maps a server-side unique violation (23505) to the lease-name field error', async () => {
    setup({ save_lease: () => { throw new RpcError('duplicate key value', '23505'); } });
    const args = makeArgs();
    await submit(args);
    expect(args.setLeaseNameError).toHaveBeenLastCalledWith(DUPLICATE_NAME_MESSAGE);
    expect(lastError(args)).toBe('');
    expect(args.onSuccess).not.toHaveBeenCalled();
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
    expect(reportCriticalError).toHaveBeenCalledWith(expect.anything(), 'save_lease', expect.objectContaining({ code: '23505' }));
  });

  it('surfaces generic RPC errors verbatim', async () => {
    setup({ save_lease: () => { throw new RpcError('Cannot modify lease transactions in a closed accounting period'); } });
    const args = makeArgs();
    await submit(args);
    expect(lastError(args)).toBe('Cannot modify lease transactions in a closed accounting period');
    expect(args.onSuccess).not.toHaveBeenCalled();
  });

  it('errors (with a sanitised generic message) when the server returns no result', async () => {
    setup({ save_lease: () => null });
    const args = makeArgs();
    await submit(args);
    expect(lastError(args)).toBe(GENERIC);
    expect(args.onSuccess).not.toHaveBeenCalled();
    expect(reportCriticalError).toHaveBeenCalled();
  });

  it('finance with an override reason saves and records the override for the new lease id', async () => {
    const args = makeArgs({
      formData: makeFormData({ lease_classification: 'finance', classification_override_reason: '  Policy choice  ' }),
    });
    await submit(args);
    const override = fake.calls.find((c) => c.fn === 'set_classification_override');
    expect(override?.args).toEqual({ p_lease_id: 'new-lease-id', p_reason: 'Policy choice' });
    expect(args.onSuccess).toHaveBeenCalled();
  });

  it('a failing override RPC surfaces its error and skips onSuccess', async () => {
    setup({ set_classification_override: () => { throw new RpcError('Only approvers may override classification'); } });
    const args = makeArgs({
      formData: makeFormData({ lease_classification: 'finance', classification_override_reason: 'Reason' }),
    });
    await submit(args);
    expect(saveCalls()).toHaveLength(1);
    expect(lastError(args)).toBe(GENERIC);
    expect(args.onSuccess).not.toHaveBeenCalled();
  });

  it('sends variable payment tranches as the payment schedule', async () => {
    const tranches: PaymentTrancheRow[] = [
      { id: 't1', fromMonth: 1, toMonth: 6, paymentAmount: 800 },
      { id: 't2', fromMonth: 7, toMonth: 12, paymentAmount: 1200 },
    ];
    const args = makeArgs({ useVariablePayments: true, paymentTranches: tranches });
    await submit(args);
    expect(saveArgs().p_payment_schedule).toEqual([
      { from_month: 1, to_month: 6, payment_amount: 800 },
      { from_month: 7, to_month: 12, payment_amount: 1200 },
    ]);
  });

  it('uses the termination-adjusted end date when termination is reasonably certain', async () => {
    const args = makeArgs({
      formData: makeFormData({
        lease_end_date: '2027-12-31',
        termination_option_month: 12,
        termination_option_reasonably_certain: true,
      }),
    });
    await submit(args);
    expect(saveCalls()).toHaveLength(1);
    expect(args.onSuccess).toHaveBeenCalled();
  });
});

describe('useLeaseFormActions.handleSubmit — editing', () => {
  const existing = { id: 'lease-1', organization_id: 'org-1', classification_override_reason: 'Old reason' } as Lease;

  it('edit of an unposted lease sends the id, skips the duplicate pre-check and clears a stale override', async () => {
    const args = makeArgs({ lease: existing, formData: makeFormData({ lease_name: 'Existing HQ' }) });
    setup({ save_lease: () => 'lease-1' });
    await submit(args);
    expect(saveArgs().p_lease.id).toBe('lease-1');
    expect(args.setLeaseNameError).not.toHaveBeenCalledWith(DUPLICATE_NAME_MESSAGE);
    const override = fake.calls.find((c) => c.fn === 'set_classification_override');
    expect(override?.args).toEqual({ p_lease_id: 'lease-1', p_reason: '' });
    expect(args.onSuccess).toHaveBeenCalled();
  });

  it('maps the server posted-period block to the Contract Modification message', async () => {
    setup({ save_lease: () => { throw new RpcError('Lease has posted periods'); } });
    const args = makeArgs({ lease: existing });
    await submit(args);
    expect(lastError(args)).toBe(POSTED_LEASE_MESSAGE);
  });

  it('posted lease: rename is allowed and only descriptive fields are sent', async () => {
    setup({ save_lease: () => 'lease-1' });
    const args = makeArgs({
      lease: existing,
      postedThrough: '2026-06-01',
      // Invalid accounting inputs are ignored on the descriptive-only path
      formData: makeFormData({ lease_name: ' Renamed HQ ', payment_amount: 0, lease_end_date: '' }),
    });
    await submit(args);
    const a = saveArgs();
    expect(a.p_lease).toMatchObject({ id: 'lease-1', lease_name: 'Renamed HQ' });
    expect(a.p_lease).not.toHaveProperty('payment_amount');
    expect(a.p_payment_schedule).toEqual([]);
    expect(a.p_amortization).toEqual([]);
    expect(a.p_recognition).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    expect(args.setLoading).toHaveBeenNthCalledWith(1, true);
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
    expect(args.onSuccess).toHaveBeenCalled();
  });

  it('posted lease: a blocked edit surfaces the lock message', async () => {
    setup({ save_lease: () => { throw new RpcError('Use Contract Modification to change it.'); } });
    const args = makeArgs({ lease: existing, postedThrough: '2026-06-01' });
    await submit(args);
    expect(lastError(args)).toBe(POSTED_LEASE_MESSAGE);
    expect(args.onSuccess).not.toHaveBeenCalled();
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
    expect(reportCriticalError).toHaveBeenCalled();
  });

  it('posted lease: duplicate name (23505) shows the duplicate message in the general error', async () => {
    setup({ save_lease: () => { throw new RpcError('dup', '23505'); } });
    const args = makeArgs({ lease: existing, postedThrough: '2026-06-01' });
    await submit(args);
    expect(lastError(args)).toBe(DUPLICATE_NAME_MESSAGE);
  });

  it('posted lease: still validates the lease name first', async () => {
    const args = makeArgs({ lease: existing, postedThrough: '2026-06-01', formData: makeFormData({ lease_name: '' }) });
    await submit(args);
    expect(lastError(args)).toBe('Lease name is required.');
    expect(fake.calls).toHaveLength(0);
  });
});

describe('useLeaseFormActions.loadExistingPaymentSchedule', () => {
  it('loads tranches for the lease in month order and enables variable payments', async () => {
    tables.lease_payment_schedules = [
      { id: 's2', lease_id: 'lease-1', from_month: 7, to_month: 12, payment_amount: 1200 },
      { id: 's1', lease_id: 'lease-1', from_month: 1, to_month: 6, payment_amount: 800 },
      { id: 'sx', lease_id: 'lease-2', from_month: 1, to_month: 12, payment_amount: 5 },
    ];
    const args = makeArgs();
    const { result } = renderHook(() => useLeaseFormActions(args));
    await act(async () => {
      await result.current.loadExistingPaymentSchedule('lease-1');
    });
    expect(args.setUseVariablePayments).toHaveBeenCalledWith(true);
    const rows = vi.mocked(args.setPaymentTranches).mock.calls[0][0] as PaymentTrancheRow[];
    expect(rows.map((r) => [r.fromMonth, r.toMonth])).toEqual([[1, 6], [7, 12]]);
  });

  it('does nothing when the lease has no schedule', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useLeaseFormActions(args));
    await act(async () => {
      await result.current.loadExistingPaymentSchedule('lease-1');
    });
    expect(args.setUseVariablePayments).not.toHaveBeenCalled();
    expect(args.setPaymentTranches).not.toHaveBeenCalled();
  });

  it('does nothing when the query fails', async () => {
    fake.failures.select = { lease_payment_schedules: 'boom' };
    const args = makeArgs();
    const { result } = renderHook(() => useLeaseFormActions(args));
    await act(async () => {
      await result.current.loadExistingPaymentSchedule('lease-1');
    });
    expect(args.setPaymentTranches).not.toHaveBeenCalled();
  });
});

describe('useLeaseFormActions.runClassificationWizard / classifyCurrent', () => {
  it('requires valid dates', () => {
    const args = makeArgs({ formData: makeFormData({ lease_term_months: '', lease_end_date: '2025-01-01' }) });
    const { result } = renderHook(() => useLeaseFormActions(args));
    act(() => result.current.runClassificationWizard());
    expect(lastError(args)).toBe('Please set valid lease start and end dates first');
    expect(args.setClassificationResult).not.toHaveBeenCalled();
  });

  it('requires a payment amount and borrowing rate', () => {
    const args = makeArgs({ formData: makeFormData({ incremental_borrowing_rate: '' }) });
    const { result } = renderHook(() => useLeaseFormActions(args));
    act(() => result.current.runClassificationWizard());
    expect(lastError(args)).toBe('Please enter payment amount and borrowing rate first');
  });

  it('classifies, stores the result, marks the form auto-classified and closes the wizard', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useLeaseFormActions(args));
    act(() => result.current.runClassificationWizard());
    expect(lastError(args)).toBe('');
    const res = vi.mocked(args.setClassificationResult).mock.calls[0][0] as { classification: string };
    expect(['operating', 'finance']).toContain(res.classification);
    const updater = vi.mocked(args.setFormData).mock.calls[0][0] as (p: LeaseFormData) => LeaseFormData;
    const next = updater(makeFormData());
    expect(next.auto_classified).toBe(true);
    expect(next.lease_classification).toBe(res.classification);
    expect(args.setShowClassificationWizard).toHaveBeenCalledWith(false);
  });

  it('a transfer-of-ownership lease classifies as finance', () => {
    const args = makeArgs({ formData: makeFormData({ transfer_ownership: true }) });
    const { result } = renderHook(() => useLeaseFormActions(args));
    expect(result.current.classifyCurrent().classification).toBe('finance');
  });

  it('classifies with variable payment tranches', () => {
    const args = makeArgs({
      useVariablePayments: true,
      paymentTranches: [{ id: 't1', fromMonth: 1, toMonth: 12, paymentAmount: 1000 }],
    });
    const { result } = renderHook(() => useLeaseFormActions(args));
    expect(result.current.classifyCurrent().classification).toBe('operating');
  });
});

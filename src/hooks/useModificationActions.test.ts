import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import type {
  CancellationFormData,
  CancellationRow,
  ModificationFormData,
  ModificationRow,
} from '../components/modifications/types';
import { finalizeSavedItem } from '../utils/approvals';
import { useModificationActions } from './useModificationActions';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));
vi.mock('../utils/approvals', async (orig) => ({
  ...(await orig<typeof import('../utils/approvals')>()),
  finalizeSavedItem: vi.fn(),
}));

const finalize = vi.mocked(finalizeSavedItem);
type Fake = ReturnType<typeof createFakeSupabase>;

const LEASE = {
  id: 'L1',
  organization_id: 'org-1',
  lease_name: 'HQ',
  payment_amount: 1000,
  lease_term_months: 36,
  discount_rate: 0.05,
  incremental_borrowing_rate: 0.06,
  rou_asset: 30000,
  lease_liability: 31000,
} as unknown as Lease;

const MOD_FORM: ModificationFormData = {
  lease_id: 'L1',
  modification_date: '2026-03-01',
  modification_type: 'term_extension',
  reason: 'Extend',
  old_monthly_payment: null,
  new_monthly_payment: 1200,
  old_lease_term: null,
  new_lease_term: 48,
  old_discount_rate: null,
  new_discount_rate: 0.05,
  accounting_treatment: 'remeasurement',
  remeasurement_required: true,
  notes: 'n',
  separate_contract: false,
  new_classification: 'operating',
  new_fair_value: null,
  new_economic_life_months: null,
};

const CAN_FORM: CancellationFormData = {
  lease_id: 'L1',
  cancellation_date: '2026-04-01',
  cancellation_reason: 'Moving',
  early_termination: true,
  termination_penalty: 500,
  final_payment_amount: 250,
  settlement_details: 'paid',
};

const PREVIEW = {
  new_rou_asset: 40000,
  new_lease_liability: 41000,
  old_rou_asset: 30000,
  old_lease_liability: 31000,
  rou_adjustment: 10000,
  liability_adjustment: 10000,
};

const evt = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

let tables: Tables;
let fake: Fake;

function setup(over: Partial<Parameters<typeof useModificationActions>[0]> = {}) {
  const spies = {
    loadData: vi.fn(),
    setErrorMessage: vi.fn(),
    setSuccessMessage: vi.fn(),
    closeModForm: vi.fn(),
    closeCanForm: vi.fn(),
    computePreview: vi.fn(() => PREVIEW),
  };
  const { result } = renderHook(() =>
    useModificationActions({
      leases: [LEASE],
      modForm: MOD_FORM,
      canForm: CAN_FORM,
      editingMod: null,
      editingCan: null,
      ...spies,
      ...over,
    }),
  );
  const last = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];
  const lastError = () => last(spies.setErrorMessage);
  const lastSuccess = () => last(spies.setSuccessMessage);
  return { result, ...spies, ...over, lastError, lastSuccess };
}

const inserted = (table: string) => {
  const w = fake.writes.find((x) => x.op === 'insert' && x.table === table);
  return w && 'rows' in w ? w.rows[0] : undefined;
};

beforeEach(() => {
  finalize.mockReset();
  finalize.mockImplementation(async (_t, _id, status) => status === 'pending_approval');
  tables = { leases: [LEASE as unknown as Tables[string][number]], contract_modifications: [], contract_cancellations: [] } as Tables;
  fake = createFakeSupabase(tables, { userId: 'user-1' });
  h.client = fake as unknown as Record<string, unknown>;
});

describe('useModificationActions – handleModSubmit', () => {
  it('requires a lease to be selected', async () => {
    const s = setup({ modForm: { ...MOD_FORM, lease_id: '' } });
    const e = evt();
    await act(() => s.result.current.handleModSubmit(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(s.lastError()).toBe('Please select a lease.');
    expect(fake.writes).toEqual([]);
    expect(s.loadData).not.toHaveBeenCalled();
  });

  it('creates a modification scoped to the lease org and sends it for approval', async () => {
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    const row = inserted('contract_modifications');
    expect(row).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      lease_id: 'L1',
      status: 'pending_approval',
      // blank "old" values fall back to the lease's current terms
      old_monthly_payment: 1000,
      old_lease_term: 36,
      old_discount_rate: 0.05,
      new_monthly_payment: 1200,
      new_rou_asset: 40000,
      new_lease_liability: 41000,
      fair_value_at_modification: null,
      remaining_economic_life_months: null,
    });
    expect(finalize).toHaveBeenCalledWith('contract_modification', 'contract_modifications-new-1', 'pending_approval');
    expect(s.lastSuccess()).toBe(
      'Modification created and sent for approval. It will be applied once approved in Settings > Approval.',
    );
    expect(s.closeModForm).toHaveBeenCalled();
    expect(s.loadData).toHaveBeenCalled();
  });

  it('reports "applied" when the item does not require approval', async () => {
    finalize.mockResolvedValueOnce(false);
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(s.lastSuccess()).toBe('Modification created and applied.');
  });

  it('falls back to lease balances when there is no preview, and keeps fair value for a non-separate contract', async () => {
    const s = setup({
      computePreview: vi.fn(() => null),
      modForm: { ...MOD_FORM, new_fair_value: 90000, new_economic_life_months: 59.6, new_monthly_payment: 0 },
      leases: [{ ...LEASE, discount_rate: undefined } as unknown as Lease],
    });
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({
      old_rou_asset: 30000,
      old_lease_liability: 31000,
      new_rou_asset: null,
      new_lease_liability: null,
      new_monthly_payment: 0,
      old_discount_rate: 0.06,
      fair_value_at_modification: 90000,
      remaining_economic_life_months: 60,
    });
  });

  it('nulls balances and org when the lease is not in the list', async () => {
    const s = setup({ computePreview: vi.fn(() => null), leases: [], modForm: { ...MOD_FORM, separate_contract: true, new_fair_value: 5 } });
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({
      organization_id: undefined,
      old_monthly_payment: 0,
      old_lease_term: 0,
      old_discount_rate: 0,
      old_rou_asset: null,
      old_lease_liability: null,
      fair_value_at_modification: null,
    });
  });

  it('surfaces an insert error and does not close the form', async () => {
    fake.failures.write = { contract_modifications: 'boom' };
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(s.lastError()).toBe('Failed to create modification.');
    expect(s.closeModForm).not.toHaveBeenCalled();
    expect(s.loadData).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('updates an existing modification without touching owner, organization or status', async () => {
    tables.contract_modifications = [{ id: 'M1', lease_id: 'L1', status: 'pending_approval', user_id: 'owner-9', organization_id: 'org-1' }];
    const s = setup({ editingMod: { id: 'M1', status: 'pending_approval' } as ModificationRow });
    await act(() => s.result.current.handleModSubmit(evt()));
    const updates = fake.writes.filter((x) => x.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: 'contract_modifications', matched: 1 });
    const values = updates[0].values as Record<string, unknown>;
    for (const f of ['user_id', 'organization_id', 'status', 'prepared_by', 'approved_by']) expect(values).not.toHaveProperty(f);
    expect(tables.contract_modifications[0]).toMatchObject({ user_id: 'owner-9', organization_id: 'org-1', status: 'pending_approval' });
    // the fake returns null from update().select(), i.e. no saved row
    expect(s.lastSuccess()).toBe('Modification updated.');
    expect(s.closeModForm).toHaveBeenCalled();
    expect(s.loadData).toHaveBeenCalled();
  });

  it('resubmits a rejected (draft) modification with a separate status-only update', async () => {
    tables.contract_modifications = [{ id: 'M1', lease_id: 'L1', status: 'draft', user_id: 'owner-9' }];
    const s = setup({ editingMod: { id: 'M1', status: 'draft' } as ModificationRow });
    await act(() => s.result.current.handleModSubmit(evt()));
    const updates = fake.writes.filter((x) => x.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0].values).not.toHaveProperty('status');
    expect(updates[1].values).toEqual({ status: 'pending_approval' });
    expect(tables.contract_modifications[0]).toMatchObject({ user_id: 'owner-9', status: 'pending_approval' });
  });

  it('keeps an explicit 0 instead of replacing it with the lease value', async () => {
    tables.contract_modifications = [{ id: 'M1', lease_id: 'L1', status: 'pending_approval' }];
    const s = setup({
      editingMod: { id: 'M1', status: 'pending_approval' } as ModificationRow,
      modForm: { ...MOD_FORM, old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0, new_fair_value: 0, new_economic_life_months: 0 },
    });
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(fake.writes.find((x) => x.op === 'update')?.values).toMatchObject({
      old_monthly_payment: 0,
      old_lease_term: 0,
      old_discount_rate: 0,
      fair_value_at_modification: 0,
      remaining_economic_life_months: 0,
    });
  });

  it('runs approval finalization for an updated row that comes back', async () => {
    const base = fake.from;
    h.client = {
      ...fake,
      from: (t: string) => {
        const q = base(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
        return { ...q, update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'M1', status: 'approved' }, error: null }) }) }) }) };
      },
    };
    finalize.mockResolvedValueOnce(false);
    const s = setup({ editingMod: { id: 'M1' } as ModificationRow });
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(finalize).toHaveBeenCalledWith('contract_modification', 'M1', 'approved');
    expect(s.lastSuccess()).toBe('Modification updated and applied.');
  });

  it('surfaces an update error', async () => {
    fake.failures.write = { contract_modifications: 'boom' };
    const s = setup({ editingMod: { id: 'M1' } as ModificationRow });
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(s.lastError()).toBe('Failed to update modification.');
    expect(s.closeModForm).not.toHaveBeenCalled();
  });

  it('catches thrown errors and shows a safe message', async () => {
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('network unreachable')) } };
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(s.lastError()).toBe('network unreachable');
  });

  it('uses the fallback when finalization throws an internal error', async () => {
    finalize.mockRejectedValueOnce(new Error('relation foo does not exist'));
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(s.lastError()).toBe('Failed to save modification.');
    expect(s.loadData).not.toHaveBeenCalled();
  });

  it('records a null user when signed out', async () => {
    fake = createFakeSupabase(tables, { userId: 'x', signedOut: true });
    h.client = fake as unknown as Record<string, unknown>;
    const s = setup();
    await act(() => s.result.current.handleModSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({ user_id: null });
  });
});

describe('useModificationActions – handleCanSubmit', () => {
  it('requires a lease to be selected', async () => {
    const s = setup({ canForm: { ...CAN_FORM, lease_id: '' } });
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(s.lastError()).toBe('Please select a lease.');
    expect(fake.writes).toEqual([]);
  });

  it('creates a pending cancellation with preview balances', async () => {
    const s = setup();
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(inserted('contract_cancellations')).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      lease_id: 'L1',
      status: 'pending_approval',
      derecognition_posted: false,
      remaining_rou_asset: 30000,
      remaining_lease_liability: 31000,
      termination_penalty: 500,
      final_payment_amount: 250,
      gain_loss_amount: 31000 - 30000 - 500 - 250,
    });
    expect(finalize).toHaveBeenCalledWith('contract_cancellation', expect.any(String), 'pending_approval');
    expect(s.lastSuccess()).toBe(
      'Cancellation created and sent for approval. It will be applied once approved in Settings > Approval.',
    );
    expect(s.closeCanForm).toHaveBeenCalled();
    expect(s.loadData).toHaveBeenCalled();
  });

  it('defaults balances to zero for an unknown lease', async () => {
    const s = setup({ leases: [], canForm: { ...CAN_FORM, termination_penalty: 0, final_payment_amount: 0 } });
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(inserted('contract_cancellations')).toMatchObject({
      remaining_rou_asset: 0,
      remaining_lease_liability: 0,
      gain_loss_amount: 0,
      termination_penalty: 0,
      final_payment_amount: 0,
    });
  });

  it('surfaces an insert error', async () => {
    fake.failures.write = { contract_cancellations: 'boom' };
    const s = setup();
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(s.lastError()).toBe('Failed to create cancellation.');
    expect(s.closeCanForm).not.toHaveBeenCalled();
  });

  it('updates an existing cancellation', async () => {
    tables.contract_cancellations = [{ id: 'C1', lease_id: 'L1', status: 'pending_approval', user_id: 'owner-9', derecognition_posted: false }];
    const s = setup({ editingCan: { id: 'C1', status: 'pending_approval' } as CancellationRow });
    await act(() => s.result.current.handleCanSubmit(evt()));
    const w = fake.writes.find((x) => x.op === 'update');
    expect(w).toMatchObject({ table: 'contract_cancellations', matched: 1 });
    for (const f of ['user_id', 'organization_id', 'status', 'derecognition_posted']) expect(w?.values).not.toHaveProperty(f);
    expect(tables.contract_cancellations[0]).toMatchObject({ user_id: 'owner-9', status: 'pending_approval' });
    expect(s.lastSuccess()).toBe('Cancellation updated.');
    expect(s.closeCanForm).toHaveBeenCalled();
  });

  it('surfaces an update error', async () => {
    fake.failures.write = { contract_cancellations: 'boom' };
    const s = setup({ editingCan: { id: 'C1' } as CancellationRow });
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(s.lastError()).toBe('Failed to update cancellation.');
  });

  it('catches thrown errors', async () => {
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('stack overflow')) } };
    const s = setup();
    await act(() => s.result.current.handleCanSubmit(evt()));
    expect(s.lastError()).toBe('Failed to save cancellation.');
  });
});

describe('useModificationActions – handleDelete', () => {
  it('deletes a modification', async () => {
    tables.contract_modifications = [{ id: 'M1' }, { id: 'M2' }];
    const s = setup();
    await act(() => s.result.current.handleDelete('M1', 'modification'));
    expect(tables.contract_modifications.map((r) => r.id)).toEqual(['M2']);
    expect(s.setErrorMessage).toHaveBeenCalledWith('');
    expect(s.lastSuccess()).toBe('Modification deleted.');
    expect(s.loadData).toHaveBeenCalled();
  });

  it('deletes a cancellation', async () => {
    tables.contract_cancellations = [{ id: 'C1' }];
    const s = setup();
    await act(() => s.result.current.handleDelete('C1', 'cancellation'));
    expect(tables.contract_cancellations).toEqual([]);
    expect(s.lastSuccess()).toBe('Cancellation deleted.');
  });

  it('surfaces a delete error', async () => {
    fake.failures.write = { contract_cancellations: 'boom' };
    const s = setup();
    await act(() => s.result.current.handleDelete('C1', 'cancellation'));
    expect(s.lastError()).toBe('Failed to delete cancellation.');
    expect(s.loadData).not.toHaveBeenCalled();
  });

  it('catches a thrown error', async () => {
    h.client = { ...fake, from: () => { throw new Error('Cannot delete posted entries'); } };
    const s = setup();
    await act(() => s.result.current.handleDelete('M1', 'modification'));
    expect(s.lastError()).toBe('Cannot delete posted entries');
  });
});

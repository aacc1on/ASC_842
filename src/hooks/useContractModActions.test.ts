import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import type {
  ContractCancellationForm,
  ContractModificationForm,
  ContractModificationRow,
} from '../components/contract-mods/contractModHelpers';
import { finalizeSavedItem } from '../utils/approvals';
import { useContractModActions } from './useContractModActions';

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
  id: 'lease-1',
  organization_id: 'org-1',
  lease_name: 'HQ',
  payment_amount: 1500,
  lease_term_months: 36,
  discount_rate: 5,
  rou_asset: 1000,
  lease_liability: 1200,
} as unknown as Lease;

function modForm(over: Partial<ContractModificationForm> = {}): ContractModificationForm {
  return {
    lease_id: 'lease-1',
    modification_date: '2026-03-01',
    modification_type: 'term_extension',
    reason: 'Extend',
    old_monthly_payment: null,
    new_monthly_payment: 2000,
    old_lease_term: null,
    new_lease_term: 48,
    old_discount_rate: null,
    new_discount_rate: 6,
    notes: 'n',
    separate_contract: false,
    new_fair_value: null,
    new_economic_life_months: null,
    new_classification: 'operating',
    ...over,
  };
}

function canForm(over: Partial<ContractCancellationForm> = {}): ContractCancellationForm {
  return {
    lease_id: 'lease-1',
    cancellation_date: '2026-04-01',
    cancellation_reason: 'Exit',
    early_termination: true,
    termination_penalty: 50,
    final_payment_amount: 25,
    settlement_details: 'paid',
    ...over,
  };
}

let tables: Tables;
let fake: Fake;
let spies: ReturnType<typeof makeSpies>;

function makeSpies() {
  return {
    loadData: vi.fn(),
    setSubmitting: vi.fn(),
    setErrorMessage: vi.fn(),
    setSuccessMessage: vi.fn(),
    setShowModificationModal: vi.fn(),
    setShowCancellationModal: vi.fn(),
    setEditingModification: vi.fn(),
    resetModificationForm: vi.fn(),
    resetCancellationForm: vi.fn(),
  };
}

function setup(opts: {
  modificationForm?: ContractModificationForm;
  cancellationForm?: ContractCancellationForm;
  editing?: ContractModificationRow | null;
  leases?: Lease[];
} = {}) {
  return renderHook(() => useContractModActions({
    leases: opts.leases ?? [LEASE],
    modificationForm: opts.modificationForm ?? modForm(),
    cancellationForm: opts.cancellationForm ?? canForm(),
    editingModification: opts.editing ?? null,
    ...spies,
  })).result;
}

const evt = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];
const inserted = (table: string): Row => {
  const w = fake.writes.find((x) => x.table === table && x.op === 'insert');
  if (!w || w.op !== 'insert') throw new Error(`no insert into ${table}`);
  return w.rows[0];
};

beforeEach(() => {
  tables = { leases: [], contract_modifications: [], contract_cancellations: [] } as unknown as Tables;
  fake = createFakeSupabase(tables, { userId: 'user-1' });
  h.client = fake as unknown as Record<string, unknown>;
  spies = makeSpies();
  finalize.mockReset();
});

describe('useContractModActions - handleModificationSubmit', () => {
  it('requires a lease to be selected', async () => {
    const result = setup({ modificationForm: modForm({ lease_id: '' }) });
    const e = evt();
    await act(() => result.current.handleModificationSubmit(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(lastCall(spies.setErrorMessage)).toBe('Please select a lease.');
    expect(spies.setSubmitting).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it('creates a pending modification scoped to the lease org and reports it was sent for approval', async () => {
    finalize.mockResolvedValue(true);
    const result = setup();
    await act(() => result.current.handleModificationSubmit(evt()));

    const row = inserted('contract_modifications');
    expect(row).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      lease_id: 'lease-1',
      status: 'pending_approval',
      separate_contract: false,
      // blank "old" values fall back to the lease's current terms
      old_monthly_payment: 1500,
      old_lease_term: 36,
      old_discount_rate: 5,
      new_monthly_payment: 2000,
      new_lease_term: 48,
      fair_value_at_modification: null,
      remaining_economic_life_months: null,
    });
    expect(finalize).toHaveBeenCalledWith('contract_modification', 'contract_modifications-new-1', 'pending_approval');
    expect(lastCall(spies.setSuccessMessage)).toBe(
      'Modification created and sent for approval. It will be applied once approved in Settings > Approval.',
    );
    expect(spies.setShowModificationModal).toHaveBeenCalledWith(false);
    expect(spies.setEditingModification).toHaveBeenCalledWith(null);
    expect(spies.resetModificationForm).toHaveBeenCalled();
    expect(spies.loadData).toHaveBeenCalledTimes(1);
    expect(spies.setSubmitting.mock.calls).toEqual([[true], [false]]);
  });

  it('reports "applied" when the saved item does not require approval', async () => {
    finalize.mockResolvedValue(false);
    const result = setup({
      modificationForm: modForm({ old_monthly_payment: 900, old_lease_term: 12, old_discount_rate: 4, new_fair_value: 5000, new_economic_life_months: 59.6 }),
    });
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({
      old_monthly_payment: 900,
      old_lease_term: 12,
      old_discount_rate: 4,
      fair_value_at_modification: 5000,
      remaining_economic_life_months: 60,
    });
    expect(lastCall(spies.setSuccessMessage)).toBe('Modification created and applied.');
  });

  it('nulls remeasurement inputs for a separate contract and falls back to IBR / zero for unknown leases', async () => {
    finalize.mockResolvedValue(true);
    const ibrLease = { ...LEASE, discount_rate: undefined, incremental_borrowing_rate: 7 } as unknown as Lease;
    const result = setup({
      leases: [ibrLease],
      modificationForm: modForm({ separate_contract: true, new_fair_value: 5000, new_economic_life_months: 60, new_monthly_payment: 0, new_lease_term: 0, new_discount_rate: 0 }),
    });
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({
      separate_contract: true,
      fair_value_at_modification: null,
      remaining_economic_life_months: null,
      old_discount_rate: 7,
      new_monthly_payment: 0,
      new_lease_term: 0,
      new_discount_rate: 0,
    });

    fake.writes.length = 0;
    const orphan = setup({ leases: [], modificationForm: modForm({ lease_id: 'ghost' }) });
    await act(() => orphan.current.handleModificationSubmit(evt()));
    expect(inserted('contract_modifications')).toMatchObject({
      organization_id: undefined,
      old_monthly_payment: 0,
      old_lease_term: 0,
      old_discount_rate: 0,
    });
  });

  it('shows the fallback message when the insert fails and keeps the modal open', async () => {
    fake.failures.write = { contract_modifications: 'insert violates row-level security policy' };
    const result = setup();
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to create modification.');
    expect(spies.setSuccessMessage).toHaveBeenCalledTimes(1); // only the initial clear
    expect(spies.setShowModificationModal).not.toHaveBeenCalled();
    expect(spies.loadData).not.toHaveBeenCalled();
    expect(lastCall(spies.setSubmitting)).toBe(false);
  });

  it('surfaces intentional guard messages from the database', async () => {
    fake.failures.write = { contract_modifications: 'Cannot modify a lease in a closed period' };
    const result = setup();
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Cannot modify a lease in a closed period');
  });

  it('catches unexpected exceptions with the generic save message', async () => {
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('socket hang up xyz')) } };
    const result = setup();
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to save modification.');
    expect(spies.setSubmitting.mock.calls).toEqual([[true], [false]]);
  });

  it('stores a null user id when signed out', async () => {
    fake = createFakeSupabase(tables, { userId: 'x', signedOut: true });
    h.client = fake as unknown as Record<string, unknown>;
    finalize.mockResolvedValue(true);
    const result = setup();
    await act(() => result.current.handleModificationSubmit(evt()));
    expect(inserted('contract_modifications').user_id).toBeNull();
  });

  describe('editing an existing modification', () => {
    const editing = { id: 'mod-9', lease_id: 'lease-1' } as ContractModificationRow;

    it('updates the row by id and closes the modal (no returned row -> plain message)', async () => {
      tables.contract_modifications = [{ id: 'mod-9', lease_id: 'lease-1', status: 'draft' }];
      tables.contract_modifications[0].user_id = 'owner-9';
      const result = setup({ editing: { ...editing, status: 'draft' } });
      await act(() => result.current.handleModificationSubmit(evt()));
      const [w, resubmit] = fake.writes.filter((x) => x.op === 'update');
      expect(w).toMatchObject({ table: 'contract_modifications', matched: 1 });
      for (const f of ['user_id', 'organization_id', 'status']) expect(w.values).not.toHaveProperty(f);
      expect(resubmit.values).toEqual({ status: 'pending_approval' });
      expect(tables.contract_modifications[0]).toMatchObject({ status: 'pending_approval', user_id: 'owner-9' });
      expect(finalize).not.toHaveBeenCalled();
      expect(lastCall(spies.setSuccessMessage)).toBe('Modification updated.');
      expect(spies.setEditingModification).toHaveBeenCalledWith(null);
      expect(spies.loadData).toHaveBeenCalled();
    });

    it('routes the updated row through approval when it is returned', async () => {
      finalize.mockResolvedValue(true);
      const eqArgs: unknown[] = [];
      const chain = {
        update: () => chain,
        eq: (...a: unknown[]) => { eqArgs.push(a); return chain; },
        select: () => chain,
        single: () => Promise.resolve({ data: { id: 'mod-9', status: 'pending_approval' }, error: null }),
      };
      h.client = { ...fake, from: () => chain };
      const result = setup({ editing });
      await act(() => result.current.handleModificationSubmit(evt()));
      expect(eqArgs).toEqual([['id', 'mod-9']]);
      expect(finalize).toHaveBeenCalledWith('contract_modification', 'mod-9', 'pending_approval');
      expect(lastCall(spies.setSuccessMessage)).toBe(
        'Modification updated and sent for approval. It will be applied once approved in Settings > Approval.',
      );
    });

    it('shows the update fallback on error', async () => {
      fake.failures.write = { contract_modifications: 'boom internal' };
      const result = setup({ editing });
      await act(() => result.current.handleModificationSubmit(evt()));
      expect(lastCall(spies.setErrorMessage)).toBe('Failed to update modification.');
      expect(spies.setShowModificationModal).not.toHaveBeenCalled();
    });
  });
});

describe('useContractModActions - handleCancellationSubmit', () => {
  it('requires a lease to be selected', async () => {
    const result = setup({ cancellationForm: canForm({ lease_id: '' }) });
    await act(() => result.current.handleCancellationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Please select a lease.');
    expect(fake.writes).toEqual([]);
  });

  it('inserts a pending cancellation with lease balances and sends it for approval', async () => {
    finalize.mockResolvedValue(true);
    const result = setup();
    await act(() => result.current.handleCancellationSubmit(evt()));
    const row = inserted('contract_cancellations');
    expect(row).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      lease_id: 'lease-1',
      status: 'pending_approval',
      derecognition_posted: false,
      early_termination: true,
      remaining_rou_asset: 1000,
      remaining_lease_liability: 1200,
      termination_penalty: 50,
      final_payment_amount: 25,
    });
    expect(finalize).toHaveBeenCalledWith('contract_cancellation', 'contract_cancellations-new-1', 'pending_approval');
    expect(lastCall(spies.setSuccessMessage)).toMatch(/^Cancellation created and sent for approval/);
    expect(spies.setShowCancellationModal).toHaveBeenCalledWith(false);
    expect(spies.resetCancellationForm).toHaveBeenCalled();
    expect(spies.loadData).toHaveBeenCalled();
    expect(spies.setSubmitting.mock.calls).toEqual([[true], [false]]);
  });

  it('defaults balances to zero for an unknown lease and reports applied', async () => {
    finalize.mockResolvedValue(false);
    const result = setup({ leases: [], cancellationForm: canForm({ termination_penalty: 0, final_payment_amount: 0 }) });
    await act(() => result.current.handleCancellationSubmit(evt()));
    expect(inserted('contract_cancellations')).toMatchObject({
      organization_id: undefined,
      remaining_rou_asset: 0,
      remaining_lease_liability: 0,
      gain_loss_amount: 0,
      termination_penalty: 0,
      final_payment_amount: 0,
    });
    expect(lastCall(spies.setSuccessMessage)).toBe('Cancellation created and applied.');
  });

  it('reports a plain message when the insert returns no row', async () => {
    const chain = { insert: () => chain, select: () => chain, single: () => Promise.resolve({ data: null, error: null }) };
    h.client = { ...fake, from: () => chain };
    const result = setup();
    await act(() => result.current.handleCancellationSubmit(evt()));
    expect(finalize).not.toHaveBeenCalled();
    expect(lastCall(spies.setSuccessMessage)).toBe('Cancellation created.');
  });

  it('shows the fallback on insert error', async () => {
    fake.failures.write = { contract_cancellations: 'relation does not exist' };
    const result = setup();
    await act(() => result.current.handleCancellationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to create cancellation.');
    expect(spies.setShowCancellationModal).not.toHaveBeenCalled();
    expect(spies.loadData).not.toHaveBeenCalled();
  });

  it('catches thrown errors (e.g. approval finalisation failure)', async () => {
    finalize.mockRejectedValue(new Error('kaboom'));
    const result = setup();
    await act(() => result.current.handleCancellationSubmit(evt()));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to save cancellation.');
    expect(spies.loadData).not.toHaveBeenCalled();
    expect(lastCall(spies.setSubmitting)).toBe(false);
  });
});

describe('useContractModActions - handleDeleteModification', () => {
  it('deletes by id and refreshes', async () => {
    tables.contract_modifications = [{ id: 'm1' }, { id: 'm2' }];
    const result = setup();
    await act(() => result.current.handleDeleteModification('m1'));
    expect(tables.contract_modifications.map((r) => r.id)).toEqual(['m2']);
    expect(lastCall(spies.setSuccessMessage)).toBe('Modification deleted.');
    expect(spies.loadData).toHaveBeenCalled();
    expect(spies.setSubmitting.mock.calls).toEqual([[true], [false]]);
  });

  it('shows an error when the delete fails', async () => {
    fake.failures.write = { contract_modifications: 'internal' };
    const result = setup();
    await act(() => result.current.handleDeleteModification('m1'));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to delete modification.');
    expect(spies.loadData).not.toHaveBeenCalled();
  });

  it('maps a permission error code to a safe message', async () => {
    const chain = { delete: () => chain, eq: () => Promise.resolve({ error: { message: 'rls', code: '42501' } }) };
    h.client = { ...fake, from: () => chain };
    const result = setup();
    await act(() => result.current.handleDeleteModification('m1'));
    expect(lastCall(spies.setErrorMessage)).toMatch(/permission/i);
  });

  it('catches thrown errors', async () => {
    h.client = { ...fake, from: () => { throw new Error('offline xyz'); } };
    const result = setup();
    await act(() => result.current.handleDeleteModification('m1'));
    expect(lastCall(spies.setErrorMessage)).toBe('Failed to delete modification.');
    expect(lastCall(spies.setSubmitting)).toBe(false);
  });
});

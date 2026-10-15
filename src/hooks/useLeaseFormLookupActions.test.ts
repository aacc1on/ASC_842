import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useLeaseFormLookupActions } from './useLeaseFormLookupActions';
import type { BranchOption } from './leaseFormActionTypes';
import type { FixedAssetType } from '../types/lease';
import type { LeaseFormData } from '../components/lease-form/types';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';
const DUPLICATE = 'A record with this name already exists. Use a different name.';

type Fake = ReturnType<typeof createFakeSupabase>;
type Args = Parameters<typeof useLeaseFormLookupActions>[0];

let tables: Tables;
let fake: Fake;
let insertError: Record<string, { message: string; code?: string } | Error>;

function install() {
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = {
    ...fake,
    from: (table: string) => {
      const q = fake.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const err = insertError[table];
      if (!err) return q;
      const chain: Record<string, unknown> = {
        insert: () => chain, select: () => chain,
        single: () => (err instanceof Error ? Promise.reject(err) : Promise.resolve({ data: null, error: err })),
      };
      return chain;
    },
  };
}

/** Real-ish state: setters apply functional updaters to a local store. */
function makeArgs(over: Partial<Args> = {}) {
  const state = {
    branches: [{ id: 'b1', branch_name: 'Zurich', branch_code: 'ZH' }] as BranchOption[],
    assetTypes: [{ id: 'a1', type_name: 'Vehicles' }] as unknown as FixedAssetType[],
    form: { branch_id: '', fixed_asset_type_id: '' } as unknown as LeaseFormData,
  };
  const apply = <T,>(cur: T, v: T | ((p: T) => T)) => (typeof v === 'function' ? (v as (p: T) => T)(cur) : v);
  const args: Args = {
    userId: 'u1',
    formCompanyId: 'c1',
    setFormData: vi.fn((v) => { state.form = apply(state.form, v); }),
    setError: vi.fn(),
    setLoading: vi.fn(),
    setBranches: vi.fn((v) => { state.branches = apply(state.branches, v); }),
    setFixedAssetTypes: vi.fn((v) => { state.assetTypes = apply(state.assetTypes, v); }),
    newBranchName: '  Amsterdam ',
    setNewBranchName: vi.fn(),
    newBranchCode: ' AMS ',
    setNewBranchCode: vi.fn(),
    setShowNewBranchForm: vi.fn(),
    newAssetTypeName: ' Buildings ',
    setNewAssetTypeName: vi.fn(),
    newAssetTypeCode: ' BLD ',
    setNewAssetTypeCode: vi.fn(),
    setShowNewAssetTypeForm: vi.fn(),
    ...over,
  };
  return { args, state };
}

beforeEach(() => {
  tables = { branches: [], fixed_asset_types: [] };
  insertError = {};
  install();
});

describe('handleCreateBranch', () => {
  it('inserts the trimmed branch, adds it sorted, selects it and closes the form', async () => {
    const { args, state } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateBranch(); });

    expect(fake.writes).toEqual([{
      op: 'insert', table: 'branches',
      rows: [{ user_id: 'u1', branch_name: 'Amsterdam', branch_code: 'AMS', is_active: true }],
    }]);
    expect(state.branches.map((b) => b.branch_name)).toEqual(['Amsterdam', 'Zurich']);
    const created = state.branches[0];
    expect(created.id).toBeTruthy();
    expect(state.form.branch_id).toBe(created.id);
    expect(args.setError).toHaveBeenCalledWith('');
    expect(vi.mocked(args.setLoading).mock.calls).toEqual([[true], [false]]);
    expect(args.setNewBranchName).toHaveBeenCalledWith('');
    expect(args.setNewBranchCode).toHaveBeenCalledWith('');
    expect(args.setShowNewBranchForm).toHaveBeenCalledWith(false);
  });

  it('requires a company first', async () => {
    const { args } = makeArgs({ formCompanyId: '' });
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateBranch(); });
    expect(args.setError).toHaveBeenCalledWith('Please select a company before adding a branch.');
    expect(args.setLoading).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it('requires a non-blank branch name', async () => {
    const { args } = makeArgs({ newBranchName: '   ' });
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateBranch(); });
    expect(args.setError).toHaveBeenCalledWith('Branch name is required.');
    expect(fake.writes).toEqual([]);
  });

  it('maps a duplicate-name violation to a friendly message and keeps the form open', async () => {
    insertError.branches = { message: 'duplicate key value violates unique constraint', code: '23505' };
    const { args, state } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateBranch(); });
    expect(args.setError).toHaveBeenLastCalledWith(DUPLICATE);
    expect(state.branches).toHaveLength(1);
    expect(args.setShowNewBranchForm).not.toHaveBeenCalled();
    expect(vi.mocked(args.setLoading).mock.calls).toEqual([[true], [false]]);
  });

  it('shows a generic message for an unexpected failure', async () => {
    insertError.branches = new Error('');
    const { args } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateBranch(); });
    expect(args.setError).toHaveBeenLastCalledWith(GENERIC);
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('handleCreateFixedAssetType', () => {
  it('inserts the trimmed asset type, adds it sorted and selects it', async () => {
    const { args, state } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });

    expect(fake.writes).toEqual([{
      op: 'insert', table: 'fixed_asset_types',
      rows: [{ user_id: 'u1', type_name: 'Buildings', type_code: 'BLD', is_active: true }],
    }]);
    expect(state.assetTypes.map((a) => a.type_name)).toEqual(['Buildings', 'Vehicles']);
    expect(state.form.fixed_asset_type_id).toBe(state.assetTypes[0].id);
    expect(args.setNewAssetTypeName).toHaveBeenCalledWith('');
    expect(args.setNewAssetTypeCode).toHaveBeenCalledWith('');
    expect(args.setShowNewAssetTypeForm).toHaveBeenCalledWith(false);
    expect(vi.mocked(args.setLoading).mock.calls).toEqual([[true], [false]]);
  });

  it('requires a company first', async () => {
    const { args } = makeArgs({ formCompanyId: '' });
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });
    expect(args.setError).toHaveBeenCalledWith('Please select a company before adding an asset type.');
    expect(fake.writes).toEqual([]);
  });

  it('requires a non-blank asset type name', async () => {
    const { args } = makeArgs({ newAssetTypeName: '' });
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });
    expect(args.setError).toHaveBeenCalledWith('Asset type name is required.');
    expect(fake.writes).toEqual([]);
  });

  it('maps a duplicate-name violation to a friendly message', async () => {
    insertError.fixed_asset_types = { message: 'duplicate key', code: '23505' };
    const { args, state } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });
    expect(args.setError).toHaveBeenLastCalledWith(DUPLICATE);
    expect(state.assetTypes).toHaveLength(1);
    expect(args.setShowNewAssetTypeForm).not.toHaveBeenCalled();
  });

  it('passes through a safe guard message from the database', async () => {
    insertError.fixed_asset_types = { message: 'You do not have permission to add asset types' };
    const { args } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });
    expect(args.setError).toHaveBeenLastCalledWith('You do not have permission to add asset types');
    expect(args.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('hides internal detail when the fake write fails', async () => {
    h.client = { ...fake };
    fake.failures.write = { fixed_asset_types: 'new row violates row-level security policy' };
    const { args } = makeArgs();
    const { result } = renderHook(() => useLeaseFormLookupActions(args));
    await act(async () => { await result.current.handleCreateFixedAssetType(); });
    expect(args.setError).toHaveBeenLastCalledWith(GENERIC);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import { GOLDEN_ORG as ORG, type Tables } from '../test/fixtures/goldenPortfolio';
import { useLeaseFormData } from './useLeaseFormData';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;

beforeEach(() => {
  tables = {
    companies: [
      { id: 'c2', company_name: 'Zeta', is_active: true, organization_id: ORG },
      { id: 'c1', company_name: 'Acme', is_active: true, organization_id: ORG },
      { id: 'c3', company_name: 'Dormant', is_active: false, organization_id: ORG },
      { id: 'cx', company_name: 'Other org', is_active: true, organization_id: 'org-b' },
    ],
    branches: [
      { id: 'b2', branch_name: 'West', branch_code: 'W', is_active: true, organization_id: ORG },
      { id: 'b1', branch_name: 'East', branch_code: null, is_active: true, organization_id: ORG },
      { id: 'b3', branch_name: 'Closed', branch_code: 'X', is_active: false, organization_id: ORG },
      { id: 'bx', branch_name: 'Other org', branch_code: 'O', is_active: true, organization_id: 'org-b' },
    ],
    fixed_asset_types: [
      { id: 'f2', type_name: 'Vehicles', is_active: true, organization_id: ORG },
      { id: 'f1', type_name: 'Buildings', is_active: true, organization_id: ORG },
      { id: 'f3', type_name: 'Retired', is_active: false, organization_id: ORG },
    ],
  };
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = fake as unknown as Record<string, unknown>;
});

describe('useLeaseFormData', () => {
  it('loads active companies sorted by name; no company => empty scoped lists', async () => {
    const { result } = renderHook(() => useLeaseFormData(''));
    expect(result.current.companies).toEqual([]);
    await waitFor(() => expect(result.current.companies.map((c) => c.id)).toEqual(['c1', 'c2']));
    expect(result.current.branches).toEqual([]);
    expect(result.current.fixedAssetTypes).toEqual([]);
  });

  it('loads active branches (projected columns) and asset types once a company is selected', async () => {
    const { result } = renderHook(() => useLeaseFormData('c1'));
    await waitFor(() => expect(result.current.branches).toHaveLength(2));
    expect(result.current.branches).toEqual([
      { id: 'b1', branch_name: 'East', branch_code: null },
      { id: 'b2', branch_name: 'West', branch_code: 'W' },
    ]);
    await waitFor(() => expect(result.current.fixedAssetTypes.map((f) => f.id)).toEqual(['f1', 'f2']));
  });

  it('clears scoped data when the company is deselected', async () => {
    const { result, rerender } = renderHook(({ id }) => useLeaseFormData(id), { initialProps: { id: 'c1' } });
    await waitFor(() => expect(result.current.branches).toHaveLength(2));
    rerender({ id: '' });
    await waitFor(() => expect(result.current.branches).toEqual([]));
    expect(result.current.fixedAssetTypes).toEqual([]);
  });

  it('shows an error with a working retry when queries fail', async () => {
    fake.failures.select = { companies: 'x', branches: 'x', fixed_asset_types: 'x' };
    const { result } = renderHook(() => useLeaseFormData('c1'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.companies).toEqual([]);
    expect(result.current.branches).toEqual([]);
    expect(result.current.fixedAssetTypes).toEqual([]);

    fake.failures.select = {};
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.branches).toHaveLength(2));
    await waitFor(() => expect(result.current.companies).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });

  it('ignores scoped data for a company that is no longer selected', async () => {
    const { result, rerender } = renderHook(({ id }) => useLeaseFormData(id), { initialProps: { id: 'c1' } });
    rerender({ id: '' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.branches).toEqual([]);
    expect(result.current.fixedAssetTypes).toEqual([]);
  });

  it('ignores the companies response after unmount', async () => {
    const { result, unmount } = renderHook(() => useLeaseFormData(''));
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.companies).toEqual([]);
  });

  it('exposes setters for optimistic appends', async () => {
    const { result } = renderHook(() => useLeaseFormData(''));
    await waitFor(() => expect(result.current.companies).toHaveLength(2));
    act(() => result.current.setBranches([{ id: 'bn', branch_name: 'New', branch_code: null }]));
    expect(result.current.branches).toHaveLength(1);
  });
});

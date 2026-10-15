import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { GOLDEN_ORG } from '../test/fixtures/goldenPortfolio';
import { currentOrgId } from '../utils/currentOrg';
import { useAmortizationSchedule } from './useAmortizationSchedule';
import { usePolicyChecklistData, useShortTermConflictData, useCompanyElections } from './useCompanyPolicyData';
import { useCatchUpBatches } from '../components/documents/useCatchUpBatches';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const OTHER_ORG = '00000000-0000-0000-0000-0000000000b2';

function seed(opts: Partial<FakeSupabaseOptions> = {}) {
  const tables: Tables = {
    amortization_schedules: [
      { id: 's2', lease_id: 'l1', period_number: 2, organization_id: GOLDEN_ORG },
      { id: 's1', lease_id: 'l1', period_number: 1, organization_id: GOLDEN_ORG },
      { id: 'sx', lease_id: 'l1', period_number: 3, organization_id: OTHER_ORG },
      { id: 's9', lease_id: 'l2', period_number: 1, organization_id: GOLDEN_ORG },
    ],
    accounting_policy_elections: [
      { id: 'e1', company_id: 'c1', organization_id: GOLDEN_ORG },
      { id: 'e2', company_id: 'c2', organization_id: GOLDEN_ORG },
      { id: 'ex', company_id: 'c1', organization_id: OTHER_ORG },
    ],
    fixed_asset_types: [
      { id: 'a1', type_name: 'Buildings', is_active: true, organization_id: GOLDEN_ORG },
      { id: 'a2', type_name: 'Old', is_active: false, organization_id: GOLDEN_ORG },
      { id: 'ax', type_name: 'Foreign', is_active: true, organization_id: OTHER_ORG },
    ],
    companies: [{ id: 'c1', entity_type: 'private', organization_id: GOLDEN_ORG }],
    leases: [
      { id: 'l1', company_id: 'c1', status: 'active', organization_id: GOLDEN_ORG },
      { id: 'l3', company_id: 'c1', status: 'cancelled', organization_id: GOLDEN_ORG },
      { id: 'lx', company_id: 'c1', status: 'active', organization_id: OTHER_ORG },
    ],
    month_end_catch_up_batches: [
      { id: 'b1', posting_period: '2026-09', lease_id: 'l1', organization_id: GOLDEN_ORG },
      { id: 'bx', posting_period: '2026-09', lease_id: 'l1', organization_id: OTHER_ORG },
    ],
  };
  const fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
  return fake;
}

function deferredOrg() {
  let resolve: (v: string) => void = () => {};
  const promise = new Promise<string>((r) => { resolve = r; });
  vi.mocked(currentOrgId).mockReturnValueOnce(promise);
  return resolve;
}

beforeEach(() => {
  vi.mocked(currentOrgId).mockResolvedValue(GOLDEN_ORG);
});

describe('useAmortizationSchedule', () => {
  it('reads only the current organization schedule for the lease, in period order', async () => {
    seed();
    const { result } = renderHook(() => useAmortizationSchedule('l1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(result.current.error).toBeNull();
  });

  it('shows an error with a working retry', async () => {
    const fake = seed({ failures: { select: { amortization_schedules: 'boom' } } });
    const { result } = renderHook(() => useAmortizationSchedule('l1'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
    delete fake.failures.select!.amortization_schedules;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });

  it('ignores a slower request for a lease the user moved away from', async () => {
    seed();
    const resolveFirst = deferredOrg();
    const { result, rerender } = renderHook(({ id }) => useAmortizationSchedule(id), { initialProps: { id: 'l1' } });
    rerender({ id: 'l2' });
    await waitFor(() => expect(result.current.data.map((r) => r.id)).toEqual(['s9']));
    await act(async () => { resolveFirst(GOLDEN_ORG); });
    expect(result.current.data.map((r) => r.id)).toEqual(['s9']);
    expect(result.current.loading).toBe(false);
  });
});

describe('company policy data hooks', () => {
  it('policy checklist reads the company elections, active classes and entity type of the current organization', async () => {
    seed();
    const { result } = renderHook(() => usePolicyChecklistData('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.elections.map((e) => e.id)).toEqual(['e1']);
    expect(result.current.data.assetTypes.map((a) => a.id)).toEqual(['a1']);
    expect(result.current.data.entityType).toBe('private');
  });

  it('policy checklist shows an error with a working retry', async () => {
    const fake = seed({ failures: { select: { fixed_asset_types: 'boom' } } });
    const { result } = renderHook(() => usePolicyChecklistData('c1'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    delete fake.failures.select!.fixed_asset_types;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data.assetTypes).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('short-term conflict data skips cancelled and foreign leases', async () => {
    seed();
    const { result } = renderHook(() => useShortTermConflictData('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.leases.map((l) => l.id)).toEqual(['l1']);
    expect(result.current.data.assetTypes.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('company elections ignore a slower request for a previous company', async () => {
    seed();
    const resolveFirst = deferredOrg();
    const { result, rerender } = renderHook(({ id }) => useCompanyElections(id), { initialProps: { id: 'c1' } });
    rerender({ id: 'c2' });
    await waitFor(() => expect(result.current.data.map((e) => e.id)).toEqual(['e2']));
    await act(async () => { resolveFirst(GOLDEN_ORG); });
    expect(result.current.data.map((e) => e.id)).toEqual(['e2']);
  });

  it('does not load anything without a company', () => {
    seed();
    const { result } = renderHook(() => useCompanyElections(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});

describe('useCatchUpBatches', () => {
  it('reads only the current organization batches for the period', async () => {
    seed();
    const { result } = renderHook(() => useCatchUpBatches('2026-09'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.batches.map((b) => b.id)).toEqual(['b1']);
  });

  it('shows an error with a working retry', async () => {
    const fake = seed({ failures: { select: { month_end_catch_up_batches: 'boom' } } });
    const { result } = renderHook(() => useCatchUpBatches('2026-09'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    delete fake.failures.select!.month_end_catch_up_batches;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.batches).toHaveLength(1));
    expect(result.current.error).toBe('');
  });

  it('ignores a slower request for a previous period', async () => {
    seed();
    const resolveFirst = deferredOrg();
    const { result, rerender } = renderHook(({ p }) => useCatchUpBatches(p), { initialProps: { p: '2026-09' } });
    rerender({ p: '2026-10' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { resolveFirst(GOLDEN_ORG); });
    expect(result.current.batches).toEqual([]);
  });
});

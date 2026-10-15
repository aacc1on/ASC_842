import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { useCombineElectionContext } from './useCombineElectionContext';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const EMPTY = { combineElectionApproved: false, combineElectionId: null, combineElections: [] };
type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
let fromLog: string[];

function cmb(over: Row = {}): Row {
  return {
    id: 'k1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'COMBINE_LEASE_NONLEASE',
    election_value: true, effective_from: '2024-01-01', effective_to: null, status: 'approved',
    policy_version: 1, ...over,
  };
}

beforeEach(() => {
  fromLog = [];
  tables = {
    accounting_policy_elections: [
      cmb(),
      cmb({ id: 'k2', policy_version: 2, effective_to: '2024-06-30' }),
      cmb({ id: 'k-rejected', policy_version: 9, status: 'rejected' }),
      cmb({ id: 'k-other-co', company_id: 'c2', election_value: false }),
      cmb({ id: 'stl', policy_type: 'SHORT_TERM_LEASE', policy_version: 10 }),
    ],
  };
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = { ...fake, from: (t: string) => { fromLog.push(t); return fake.from(t); } };
});

afterEach(() => { vi.useRealTimers(); });

describe('useCombineElectionContext', () => {
  it('returns the empty context without querying when company or asset type is missing', () => {
    const { result, rerender } = renderHook(({ c, a }) => useCombineElectionContext(c, a, '2025-01-01'),
      { initialProps: { c: '', a: 'a1' } });
    expect(result.current).toMatchObject(EMPTY);
    rerender({ c: 'c1', a: '' });
    expect(result.current).toMatchObject(EMPTY);
    expect(fromLog).toEqual([]);
  });

  it('picks the approved election effective at the start date, scoped to the company', async () => {
    const { result } = renderHook(() => useCombineElectionContext('c1', 'a1', '2025-01-01'));
    expect(result.current).toMatchObject(EMPTY);
    await waitFor(() => expect(result.current.combineElectionId).toBe('k1'));
    expect(result.current.combineElectionApproved).toBe(true);
    expect(result.current.combineElections.map((e) => e.id).sort())
      .toEqual(['k-rejected', 'k1', 'k2', 'stl']);
  });

  it('prefers the higher version while it is in effect', async () => {
    const { result } = renderHook(() => useCombineElectionContext('c1', 'a1', '2024-03-01'));
    await waitFor(() => expect(result.current.combineElectionId).toBe('k2'));
  });

  it('reports an approved "no" election as not approved', async () => {
    const { result } = renderHook(() => useCombineElectionContext('c2', 'a1', '2025-01-01'));
    await waitFor(() => expect(result.current.combineElectionId).toBe('k-other-co'));
    expect(result.current.combineElectionApproved).toBe(false);
  });

  it('returns no election for an asset class without one', async () => {
    const { result } = renderHook(() => useCombineElectionContext('c1', 'a9', '2025-01-01'));
    await waitFor(() => expect(result.current.combineElections).toHaveLength(4));
    expect(result.current.combineElectionId).toBeNull();
  });

  it('shows an error with a working retry when the query fails, keeping the empty context', async () => {
    fake.failures.select = { accounting_policy_elections: 'boom' };
    const { result } = renderHook(() => useCombineElectionContext('c1', 'a1', '2025-01-01'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject(EMPTY);
    expect(result.current.error).toBeTruthy();
    fake.failures.select = {};
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('defaults the as-of date to today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2023-06-15T12:00:00Z'));
    tables.accounting_policy_elections = [cmb({ effective_from: '2023-01-01', effective_to: '2023-12-31' })];
    const { result } = renderHook(() => useCombineElectionContext('c1', 'a1', ''));
    await waitFor(() => expect(result.current.combineElectionId).toBe('k1'));
  });

  it('resets when the asset type is cleared', async () => {
    const { result, rerender } = renderHook(({ a }) => useCombineElectionContext('c1', a, '2025-01-01'),
      { initialProps: { a: 'a1' } });
    await waitFor(() => expect(result.current.combineElectionId).toBe('k1'));
    rerender({ a: '' });
    expect(result.current).toMatchObject(EMPTY);
  });
});

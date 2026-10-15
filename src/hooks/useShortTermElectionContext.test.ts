import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { useShortTermElectionContext } from './useShortTermElectionContext';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const EMPTY = { shortTermElectionApproved: false, shortTermElectionId: null, shortTermElections: [] };
type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
let fromLog: string[];

function stl(over: Row = {}): Row {
  return {
    id: 's1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
    election_value: true, effective_from: '2024-01-01', effective_to: null, status: 'approved',
    policy_version: 1, ...over,
  };
}

beforeEach(() => {
  fromLog = [];
  tables = {
    accounting_policy_elections: [
      stl(),
      stl({ id: 's2', policy_version: 2 }),
      stl({ id: 's-pending', policy_version: 9, status: 'pending_approval' }),
      stl({ id: 's-other-co', company_id: 'c2', election_value: false }),
      stl({ id: 'combine', policy_type: 'COMBINE_LEASE_NONLEASE', policy_version: 10 }),
    ],
  };
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = { ...fake, from: (t: string) => { fromLog.push(t); return fake.from(t); } };
});

afterEach(() => { vi.useRealTimers(); });

describe('useShortTermElectionContext', () => {
  it('returns the empty context without querying when company or asset type is missing', () => {
    const { result, rerender } = renderHook(({ c, a }) => useShortTermElectionContext(c, a, '2025-01-01'),
      { initialProps: { c: '', a: 'a1' } });
    expect(result.current).toMatchObject(EMPTY);
    rerender({ c: 'c1', a: '' });
    expect(result.current).toMatchObject(EMPTY);
    expect(fromLog).toEqual([]);
  });

  it('picks the latest approved version and exposes the company\'s elections only', async () => {
    const { result } = renderHook(() => useShortTermElectionContext('c1', 'a1', '2025-01-01'));
    expect(result.current).toMatchObject(EMPTY);
    await waitFor(() => expect(result.current.shortTermElectionId).toBe('s2'));
    expect(result.current.shortTermElectionApproved).toBe(true);
    expect(result.current.shortTermElections.map((e) => e.id).sort())
      .toEqual(['combine', 's-pending', 's1', 's2']);
  });

  it('reports an approved "no" election as not approved', async () => {
    const { result } = renderHook(() => useShortTermElectionContext('c2', 'a1', '2025-01-01'));
    await waitFor(() => expect(result.current.shortTermElectionId).toBe('s-other-co'));
    expect(result.current.shortTermElectionApproved).toBe(false);
  });

  it('returns no election when none is effective at the start date', async () => {
    const { result } = renderHook(() => useShortTermElectionContext('c1', 'a1', '2023-01-01'));
    await waitFor(() => expect(result.current.shortTermElections).toHaveLength(4));
    expect(result.current.shortTermElectionId).toBeNull();
    expect(result.current.shortTermElectionApproved).toBe(false);
  });

  it('shows an error with a working retry when the query fails, keeping the empty context', async () => {
    fake.failures.select = { accounting_policy_elections: 'boom' };
    const { result } = renderHook(() => useShortTermElectionContext('c1', 'a1', '2025-01-01'));
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
    tables.accounting_policy_elections = [stl({ effective_from: '2023-01-01', effective_to: '2023-12-31' })];
    const { result } = renderHook(() => useShortTermElectionContext('c1', 'a1', ''));
    await waitFor(() => expect(result.current.shortTermElectionId).toBe('s1'));
  });

  it('resets when the company is cleared', async () => {
    const { result, rerender } = renderHook(({ c }) => useShortTermElectionContext(c, 'a1', '2025-01-01'),
      { initialProps: { c: 'c1' } });
    await waitFor(() => expect(result.current.shortTermElectionId).toBe('s2'));
    rerender({ c: '' });
    expect(result.current).toMatchObject(EMPTY);
  });
});

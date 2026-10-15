import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { useDashboardData } from './useDashboardData';

let tables: Tables;
let fake: ReturnType<typeof createFakeSupabase>;

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: 'user-1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
}

beforeEach(() => {
  tables = {
    leases: [
      { id: 'L1', organization_id: 'org-a', company_id: 'C1', status: 'active', rou_asset: 100, lease_liability: 90 },
      { id: 'L2', organization_id: 'org-a', company_id: 'C2', status: 'active', rou_asset: 50, lease_liability: 40 },
      { id: 'LX', organization_id: 'org-b', company_id: 'C9', status: 'active', rou_asset: 999, lease_liability: 999 },
    ] as Row[],
  };
  install();
});

afterEach(() => vi.useRealTimers());

describe('useDashboardData', () => {
  it('resolves the user id', async () => {
    const { result } = renderHook(() => useDashboardData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.userId).toBe('user-1'));
    expect(fake.calls).toEqual([]);
  });

  it('leaves userId empty when signed out and reports user lookup failures', async () => {
    install({ signedOut: true });
    const { result } = renderHook(() => useDashboardData());
    await act(async () => {});
    expect(result.current.userId).toBe('');

    const onUserError = vi.fn();
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('offline')) } };
    renderHook(() => useDashboardData({ onUserError }));
    await waitFor(() => expect(onUserError).toHaveBeenCalledTimes(1));
  });

  it('deletes a lease and notifies the latest onDeleted', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useDashboardData({ onDeleted: cb }), { initialProps: { cb: first } });
    await waitFor(() => expect(result.current.userId).toBe('user-1'));
    rerender({ cb: latest });
    await act(() => result.current.handleDelete('L2'));
    expect(fake.writes).toEqual([{ op: 'delete', table: 'leases', matched: 1 }]);
    expect(tables.leases.map((l) => l.id)).toEqual(['L1', 'LX']);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
  });

  it('shows a delete error that clears after 8 seconds', async () => {
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDashboardData({ onDeleted }));
    await waitFor(() => expect(result.current.userId).toBe('user-1'));
    install({ failures: { write: { leases: 'Cannot delete a lease with posted entries.' } } });
    vi.useFakeTimers();
    await act(() => result.current.handleDelete('L1'));
    expect(result.current.error).toBe('Cannot delete a lease with posted entries.');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(tables.leases).toHaveLength(3);
    act(() => { vi.advanceTimersByTime(7999); });
    expect(result.current.error).not.toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.error).toBe('');
  });

  it('uses the fallback message for internal delete errors', async () => {
    install({ failures: { write: { leases: 'update or delete on table "leases" violates foreign key constraint' } } });
    const { result } = renderHook(() => useDashboardData());
    await act(() => result.current.handleDelete('L1'));
    expect(result.current.error).toBe('Failed to delete lease. Please try again.');
  });

  it('exposes the borrowed lease/loading setters', async () => {
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.userId).toBe('user-1'));
    act(() => {
      result.current.setLeases([{ id: 'L1' } as Lease]);
      result.current.setLoading(false);
    });
    expect(result.current.leases).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });
});

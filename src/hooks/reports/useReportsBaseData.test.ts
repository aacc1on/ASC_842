import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

import { createFakeSupabase } from '../../test/fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_COMPANY, GOLDEN_USER, type Row, type Tables } from '../../test/fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { useReportsBaseData } from './useReportsBaseData';

let tables: Tables;
let fake: ReturnType<typeof createFakeSupabase>;
let fromTables: string[];

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: GOLDEN_USER, ...opts });
  fromTables = [];
  h.client = { ...fake, from: (t: string) => { fromTables.push(t); return fake.from(t); } };
}

beforeEach(() => {
  tables = buildGoldenPortfolio().tables;
  tables.branches.push({ id: 'br-x', branch_name: 'Closed', branch_code: 'X', is_active: false });
  tables.fixed_asset_types.push({ id: 'at-x', type_name: 'Retired', type_code: 'R', is_active: false });
  install();
});

describe('useReportsBaseData', () => {
  it('loads leases with current balances, a portfolio report and active lookups', async () => {
    const { result } = renderHook(() => useReportsBaseData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.userId).toBe(GOLDEN_USER);
    expect(result.current.leases).toHaveLength(11);
    // Newest first (created_at desc).
    expect(result.current.leases[0].id).toBe(tables.leases[10].id);
    for (const l of result.current.leases) expect(l.currentBalances).toBeDefined();
    expect(result.current.report).not.toBeNull();
    expect(result.current.branchOptions).toEqual([
      { id: 'br-1', branch_name: 'North Branch', branch_code: 'N01' },
      { id: 'br-2', branch_name: 'South Branch', branch_code: 'S01' },
    ]);
    expect(result.current.assetTypeOptions.map((a) => a.id)).toEqual(['at-3', 'at-1', 'at-2']);
    expect(fake.calls.some((c) => c.fn === 'get_lease_balances_as_of')).toBe(true);
  });

  it('filters leases by the selected company', async () => {
    tables.leases.push({ ...tables.leases[0], id: 'other-company-lease', company_id: 'C-OTHER' } as Row);
    const { result } = renderHook(() => useReportsBaseData(GOLDEN_COMPANY));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toHaveLength(11);
    expect(result.current.leases.some((l) => l.id === 'other-company-lease')).toBe(false);
  });

  it('pages through more than 1,000 leases', async () => {
    const template = tables.leases[0];
    tables.leases = Array.from({ length: 1250 }, (_, i) => ({
      ...template, id: `lease-${String(i).padStart(4, '0')}`, created_at: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    }));
    tables.amortization_schedules = [];
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 10000 });
    expect(result.current.leases).toHaveLength(1250);
    expect(new Set(result.current.leases.map((l) => l.id)).size).toBe(1250);
    expect(result.current.leases[0].currentBalances).toMatchObject({ balanceStatus: 'no_schedule' });
  });

  it('returns an empty portfolio when there are no leases', async () => {
    tables.leases = [];
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toEqual([]);
    expect(result.current.report).not.toBeNull();
    expect(fake.calls.some((c) => c.fn === 'get_lease_balances_as_of')).toBe(false);
  });

  it('stops loading without querying when signed out', async () => {
    install({ signedOut: true });
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.userId).toBe('');
    expect(result.current.report).toBeNull();
    expect(fromTables).toEqual([]);
  });

  it('shows an error instead of an empty report when a lookup query fails, and reload recovers', async () => {
    install({ failures: { select: { branches: 'x', fixed_asset_types: 'y' } } });
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.report).toBeNull();
    fake.failures.select = {};
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBeNull();
    expect(result.current.leases).toHaveLength(11);
  });

  it('ends loading with an error when the lease query fails', async () => {
    install({ failures: { select: { leases: 'boom' } } });
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('ends loading with an error when signed out', async () => {
    install({ signedOut: true });
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('reload re-reads data and discards superseded requests', async () => {
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.leases = tables.leases.slice(0, 2);
    await act(async () => {
      void result.current.reload();
      void result.current.reload();
    });
    await waitFor(() => expect(result.current.leases).toHaveLength(2));
    expect(result.current.loading).toBe(false);
  });

  it('discards a stale response that resolves after the balances call', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const baseRpc = fake.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    let first = true;
    h.client = {
      ...(h.client as object),
      rpc: (fn: string, args: Record<string, unknown>): Promise<unknown> => {
        if (fn === 'get_lease_balances_as_of' && first) { first = false; return gate.then(() => baseRpc(fn, args)); }
        return baseRpc(fn, args);
      },
    };
    const { result } = renderHook(() => useReportsBaseData());
    await waitFor(() => expect(first).toBe(false));
    tables.leases = tables.leases.slice(0, 3);
    await act(async () => { await result.current.reload(); });
    expect(result.current.leases).toHaveLength(3);
    await act(async () => { release(); await gate; });
    expect(result.current.leases).toHaveLength(3);
  });
});

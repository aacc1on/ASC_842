import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createFakeSupabase, RpcError } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { DataFilters, ViewMode } from '../components/transactions/types';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { useTransactionsData } from './useTransactionsData';
import { currentOrgId } from '../utils/currentOrg';

type Op = [string, unknown[]];
interface QueryLog { table: string; ops: Op[] }

/** Wraps the fake so every query records its builder calls (table, filters, ranges). */
function recording(fake: ReturnType<typeof createFakeSupabase>, log: QueryLog[]) {
  return {
    ...fake,
    from: (table: string) => {
      const q = fake.from(table) as unknown as Record<string, unknown>;
      const entry: QueryLog = { table, ops: [] };
      log.push(entry);
      const proxy: unknown = new Proxy(q, {
        get(t, k) {
          const v = t[k as string];
          if (typeof v !== 'function') return v;
          if (k === 'then') return (v as (...a: unknown[]) => unknown).bind(t);
          return (...a: unknown[]) => {
            entry.ops.push([String(k), a]);
            const r = (v as (...x: unknown[]) => unknown).apply(t, a);
            return r === t ? proxy : r;
          };
        },
      });
      return proxy;
    },
  };
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function lease(id: string, company: string, org = ORG_A): Row {
  return {
    id, organization_id: org, company_id: company, lease_name: `Lease ${id}`, branch_id: 'br-1',
    lease_classification: 'finance', fixed_asset_type_id: 'at-1', status: 'active',
  };
}

function txRow(i: number, leaseId: string, org = ORG_A): Row {
  const day = String((i % 28) + 1).padStart(2, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  return {
    id: `tx-${String(i).padStart(5, '0')}`, organization_id: org, lease_id: leaseId,
    transaction_date: `2025-${month}-${day}`, transaction_type: 'payment',
    account_debited: 'Lease Liability', account_credited: 'Cash', debit_amount: 10, credit_amount: 10,
    description: `Payment ${i}`, reference_number: `REF-${i}`, period: `2025-${month}`,
    is_reversed: false, created_at: '2025-01-01T00:00:00Z', month_end_document_id: i % 2 ? 'doc-1' : null,
  };
}

const FILTERS: DataFilters = {
  currentPage: 1, pageSize: 25, debouncedSearch: '', filterType: 'all', filterPeriod: 'all',
  customPeriodStart: '', customPeriodEnd: '', filterFixedAssetType: 'all', filterBranch: 'all',
  filterLeaseClassification: 'all',
};

let tables: Tables;
let log: QueryLog[];
let fake: ReturnType<typeof createFakeSupabase>;

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  log = [];
  h.client = recording(fake, log) as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(currentOrgId).mockResolvedValue(ORG_A);
  tables = {
    leases: [lease('L1', 'C1'), lease('L2', 'C2')],
    branches: [
      { id: 'br-2', branch_name: 'South', organization_id: ORG_A },
      { id: 'br-1', branch_name: 'North', organization_id: ORG_A },
    ],
    transactions: [],
    lease_transactions: [],
  };
  install();
});

describe('useTransactionsData – in-memory (week/kanban) mode', () => {
  it('starts loading, then pages through more than 1,000 transactions and merges lease events', async () => {
    for (let i = 0; i < 1250; i++) tables.transactions.push(txRow(i, 'L1'));
    tables.lease_transactions.push({
      id: 'lt-1', lease_id: 'L2', organization_id: ORG_A, transaction_date: '2026-01-15', transaction_type: 'initial_recognition',
      account_debited: 'Right-of-Use Asset', account_credited: 'Lease Liability', amount: 5000, description: null, created_at: null,
    });
    // Rows for a lease from another organization are not visible to this user's lease list.
    tables.transactions.push(txRow(9999, 'L-OTHER', ORG_B));
    tables.lease_transactions.push({ id: 'lt-x', lease_id: 'L-OTHER', organization_id: ORG_B, transaction_date: '2026-02-01', transaction_type: 'initial_recognition', amount: 1 });

    const { result } = renderHook(() => useTransactionsData('week', FILTERS));
    // Note: loading is already false here because the first run sees no leases yet (see report).
    expect(result.current.transactions).toEqual([]);

    await waitFor(() => expect(result.current.transactions).toHaveLength(1251), { timeout: 8000 });
    expect(result.current.loading).toBe(false);
    expect(result.current.leases.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(result.current.branches.map((b) => b.id)).toEqual(['br-1', 'br-2']);
    expect(result.current.serverRows).toEqual([]);
    expect(result.current.serverTotalCount).toBe(0);

    const ids = new Set(result.current.transactions.map((t) => t.id));
    expect(ids.has('tx-09999')).toBe(false);
    expect(ids.has('lt-x')).toBe(false);
    expect(ids.has('tx-01249')).toBe(true);

    // Sorted newest first: the 2026 lease event leads.
    const first = result.current.transactions[0];
    expect(first).toMatchObject({
      id: 'lt-1', lease_name: 'Lease L2', reference_number: 'N/A', period: '2026-01', debit_amount: 5000,
      credit_amount: 5000, description: '', created_at: '', is_reversed: false, month_end_document_id: null,
      branch_id: 'br-1', lease_classification: 'finance',
    });
    const posted = result.current.transactions.find((t) => t.id === 'tx-00001')!;
    expect(posted).toMatchObject({ lease_name: 'Lease L1', month_end_document_id: 'doc-1', branch_id: 'br-1', reference_number: 'REF-1' });

    // Paged with .range() and scoped to the loaded lease ids.
    const txQueries = log.filter((q) => q.table === 'transactions');
    const ranges = txQueries.flatMap((q) => q.ops.filter(([op]) => op === 'range').map(([, a]) => a));
    expect(ranges).toEqual(expect.arrayContaining([[0, 999], [1000, 1999]]));
    for (const q of txQueries) {
      expect(q.ops.find(([op]) => op === 'in')).toEqual(['in', ['lease_id', ['L1', 'L2']]]);
    }
  });

  it('scopes leases and transactions to the selected company', async () => {
    tables.transactions.push(txRow(1, 'L1'), txRow(2, 'L2'));
    const { result } = renderHook(() => useTransactionsData('kanban', FILTERS, 'C2'));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    expect(result.current.leases.map((l) => l.id)).toEqual(['L2']);
    expect(result.current.transactions[0].lease_id).toBe('L2');
  });

  it('returns empty data when there are no leases', async () => {
    tables.leases = [];
    tables.transactions.push(txRow(1, 'L1'));
    const { result } = renderHook(() => useTransactionsData('week', FILTERS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions).toEqual([]);
    expect(result.current.leases).toEqual([]);
    expect(log.some((q) => q.table === 'transactions')).toBe(false);
  });

  it('clears transactions when a transaction page fails to load', async () => {
    tables.transactions.push(txRow(1, 'L1'));
    install({ failures: { select: { lease_transactions: 'boom' } } });
    const { result } = renderHook(() => useTransactionsData('week', FILTERS));
    await waitFor(() => expect(result.current.leases).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions).toEqual([]);
    expect(result.current.error).toBeTruthy();
    delete fake.failures.select!.lease_transactions;
    act(() => result.current.refreshData());
    await waitFor(() => expect(result.current.transactions.length).toBeGreaterThan(0));
    expect(result.current.error).toBeNull();
  });

  it('keeps leases empty and skips branches when the lease query fails', async () => {
    install({ failures: { select: { leases: 'denied' } } });
    const { result } = renderHook(() => useTransactionsData('week', FILTERS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toEqual([]);
    expect(result.current.branches).toEqual([]);
    expect(result.current.error).toBeTruthy();
    expect(log.some((q) => q.table === 'branches')).toBe(false);
  });

  it('refreshData reloads leases and transactions', async () => {
    tables.transactions.push(txRow(1, 'L1'));
    const { result } = renderHook(() => useTransactionsData('week', FILTERS));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    tables.transactions.push(txRow(2, 'L1'));
    act(() => result.current.refreshData());
    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
  });
});

describe('useTransactionsData – server (grid/table) mode', () => {
  it('passes filters to get_filtered_transactions and exposes rows + total count', async () => {
    const rows = [txRow(1, 'L1'), txRow(2, 'L1')];
    install({ rpc: { get_filtered_transactions: () => ({ rows, total_count: '42' }) } });
    const filters: DataFilters = {
      ...FILTERS, currentPage: 3, pageSize: 50, debouncedSearch: 'rent', filterType: 'payment', filterPeriod: 'custom',
      customPeriodStart: '2025-01-01', customPeriodEnd: '2025-03-31', filterBranch: 'br-1', filterFixedAssetType: 'at-2',
      filterLeaseClassification: 'operating',
    };
    const { result } = renderHook(() => useTransactionsData('grid', filters));
    await waitFor(() => expect(result.current.serverTotalCount).toBe(42));
    expect(result.current.loading).toBe(false);
    expect(result.current.serverRows).toHaveLength(2);
    expect(result.current.transactions).toHaveLength(2);
    const rpcCalls = fake.calls.filter((c) => c.fn === 'get_filtered_transactions');
    const call = rpcCalls[rpcCalls.length - 1];
    expect(call.args).toEqual({
      p_page: 3, p_page_size: 50, p_search: 'rent', p_type: 'payment', p_period: 'custom',
      p_period_start: '2025-01-01', p_period_end: '2025-03-31', p_branch_id: 'br-1', p_branch_filter: 'br-1',
      p_asset_type_id: 'at-2', p_asset_type_filter: 'at-2', p_lease_classification: 'operating',
    });
    // Server mode never pulls the raw transaction tables.
    expect(log.some((q) => q.table === 'transactions')).toBe(false);
  });

  it('maps "none"/"all" sentinels and blank values to null ids and defaults', async () => {
    install({ rpc: { get_filtered_transactions: () => ({ rows: 'not-an-array' }) } });
    const filters = {
      ...FILTERS, debouncedSearch: undefined, filterType: '', filterPeriod: '', filterBranch: 'none',
      filterFixedAssetType: 'none', filterLeaseClassification: '', customPeriodStart: '2025-01-01',
    } as unknown as DataFilters;
    const { result } = renderHook(() => useTransactionsData('table', filters));
    await waitFor(() => expect(fake.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fake.calls[0].args).toMatchObject({
      p_search: '', p_type: 'all', p_period: 'all', p_period_start: null, p_period_end: null,
      p_branch_id: null, p_branch_filter: 'none', p_asset_type_id: null, p_asset_type_filter: 'none',
      p_lease_classification: 'all',
    });
    expect(result.current.serverRows).toEqual([]);
    expect(result.current.serverTotalCount).toBe(0);
  });

  it('clears server rows on RPC error', async () => {
    install({ rpc: { get_filtered_transactions: () => { throw new RpcError('permission denied', '42501'); } } });
    const { result } = renderHook(() => useTransactionsData('grid', FILTERS));
    await waitFor(() => expect(fake.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverRows).toEqual([]);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.serverTotalCount).toBe(0);
  });

  it('clears data when the RPC call itself throws', async () => {
    install();
    h.client = { ...(h.client as object), rpc: () => Promise.reject(new Error('network down')) };
    const { result } = renderHook(() => useTransactionsData('grid', FILTERS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverRows).toEqual([]);
  });

  it('ignores a stale response when the view mode changes mid-flight', async () => {
    let release: (v: unknown) => void = () => undefined;
    install();
    h.client = {
      ...(h.client as object),
      rpc: () => new Promise((r) => { release = r; }),
    };
    tables.transactions.push(txRow(1, 'L1'));
    const { result, rerender } = renderHook(({ mode }: { mode: ViewMode }) => useTransactionsData(mode, FILTERS), {
      initialProps: { mode: 'grid' as ViewMode },
    });
    rerender({ mode: 'week' });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    await act(async () => { release({ data: { rows: [txRow(5, 'L1'), txRow(6, 'L1')], total_count: 2 }, error: null }); });
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.serverTotalCount).toBe(0);
  });
});

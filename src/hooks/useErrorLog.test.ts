import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { useErrorLog } from './useErrorLog';
import { currentOrgId } from '../utils/currentOrg';

beforeEach(() => { vi.mocked(currentOrgId).mockResolvedValue('o1'); });

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';

type Fake = ReturnType<typeof createFakeSupabase>;
type Chain = Record<string, (...a: unknown[]) => unknown>;
interface CallLog { method: string; args: unknown[] }

let tables: Tables;
let fake: Fake;
let log: CallLog[];
let throwOnFrom: unknown;

/** Wraps the fake query, logging builder calls and adding the `ilike` filter the fake lacks. */
function install() {
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = {
    ...fake,
    from: (table: string) => {
      if (throwOnFrom !== undefined) throw throwOnFrom;
      const target = fake.from(table) as unknown as Chain & { filters: ((r: Row) => boolean)[] };
      const proxy: Chain = new Proxy(target, {
        get(t, prop: string) {
          if (prop === 'ilike') {
            return (col: string, pattern: string) => {
              log.push({ method: prop, args: [col, pattern] });
              const needle = pattern.replace(/%/g, '').toLowerCase();
              t.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle));
              return proxy;
            };
          }
          const fn = t[prop];
          if (typeof fn !== 'function') return fn;
          if (prop === 'then') return fn.bind(t);
          return (...args: unknown[]) => { log.push({ method: prop, args }); fn.apply(t, args); return proxy; };
        },
      });
      return proxy;
    },
  };
}

function row(id: number, created_at: string, route: string | null): Row {
  return { id, organization_id: 'o1', user_id: 'u1', message: `m${id}`, stack: null, route, user_agent: null, created_at };
}

beforeEach(() => {
  log = [];
  throwOnFrom = undefined;
  tables = {
    error_logs: [
      row(1, '2025-01-01T10:00:00', '/leases'),
      row(2, '2025-01-05T23:59:59', '/Reports/balance'),
      row(3, '2025-01-10T08:00:00', null),
    ],
  };
  install();
});

describe('useErrorLog', () => {
  it('loads the latest 200 logs newest first on mount', async () => {
    const { result } = renderHook(() => useErrorLog());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(result.current.rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(log).toEqual([
      { method: 'select', args: ['*'] },
      { method: 'eq', args: ['organization_id', 'o1'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [200] },
    ]);
  });

  it('applies route and inclusive date filters', async () => {
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    log = [];
    await act(async () => {
      await result.current.loadErrorLogs({ dateFrom: '2025-01-05', dateTo: '2025-01-05', route: 'reports' });
    });
    expect(log.slice(4)).toEqual([
      { method: 'ilike', args: ['route', '%reports%'] },
      { method: 'gte', args: ['created_at', '2025-01-05T00:00:00'] },
      { method: 'lte', args: ['created_at', '2025-01-05T23:59:59'] },
    ]);
    expect(result.current.rows.map((r) => r.id)).toEqual([2]);
  });

  it('applies only the filters that are set', async () => {
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    log = [];
    await act(async () => { await result.current.loadErrorLogs({ dateFrom: '2025-01-02', dateTo: '', route: '' }); });
    expect(log.map((l) => l.method)).toEqual(['select', 'eq', 'order', 'limit', 'gte']);
    expect(result.current.rows.map((r) => r.id)).toEqual([3, 2]);
  });

  it('shows an empty list when nothing matches', async () => {
    tables.error_logs = [];
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe('');
  });

  it('reports a query error without leaking internals and keeps previous rows', async () => {
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    fake.failures.select = { error_logs: 'permission denied for table error_logs' };
    await act(async () => { await result.current.loadErrorLogs({ dateFrom: '', dateTo: '', route: '' }); });
    expect(result.current.error).toBe(GENERIC);
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(3);
  });

  it('passes through a user-safe query error', async () => {
    fake.failures.select = { error_logs: 'You do not have permission to view error logs' };
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.error).toBe('You do not have permission to view error logs'));
  });

  it('clears a previous error on the next successful load', async () => {
    fake.failures.select = { error_logs: 'boom' };
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.error).toBe(GENERIC));
    fake.failures.select = {};
    await act(async () => { await result.current.loadErrorLogs({ dateFrom: '', dateTo: '', route: '' }); });
    expect(result.current.error).toBe('');
    expect(result.current.rows).toHaveLength(3);
  });

  it('uses the fallback when the client throws', async () => {
    throwOnFrom = new Error('');
    const { result } = renderHook(() => useErrorLog());
    await waitFor(() => expect(result.current.error).toBe('Failed to load error logs'));
    expect(result.current.loading).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

import { createFakeSupabase } from '../../test/fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_AS_OF, GOLDEN_USER, type Tables } from '../../test/fixtures/goldenPortfolio';
import type { Lease } from '../../types/lease';
import type { PeriodMode } from '../../utils/reports/period';

const h = vi.hoisted(() => ({
  client: null as unknown as Record<string, unknown>,
  /** Optional override for loadFinancialSnapshot; otherwise the real implementation runs against the fake. */
  snapshot: null as null | ((...a: unknown[]) => Promise<unknown>),
  snapshotCalls: [] as unknown[][],
  /** Optional override for loadMonthReports / loadWeekReports. */
  breakdown: null as null | (() => Promise<unknown>),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));
vi.mock('../../utils/reports/financialSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/reports/financialSnapshot')>();
  return {
    ...actual,
    loadFinancialSnapshot: (...a: unknown[]) => {
      h.snapshotCalls.push(a);
      return h.snapshot ? h.snapshot(...a) : (actual.loadFinancialSnapshot as (...x: unknown[]) => Promise<unknown>)(...a);
    },
    loadMonthReports: (...a: unknown[]) => (h.breakdown ? h.breakdown() : (actual.loadMonthReports as (...x: unknown[]) => Promise<unknown>)(...a)),
    loadWeekReports: (...a: unknown[]) => (h.breakdown ? h.breakdown() : (actual.loadWeekReports as (...x: unknown[]) => Promise<unknown>)(...a)),
  };
});

import { useFinancialReportsData } from './useFinancialReportsData';

let tables: Tables;
let leases: Lease[];
const lookups = { branchOptions: [], assetTypeOptions: [] };

beforeEach(() => {
  const p = buildGoldenPortfolio();
  tables = p.tables;
  leases = p.leases;
  h.client = createFakeSupabase(tables, { userId: GOLDEN_USER }) as unknown as Record<string, unknown>;
  h.snapshot = null;
  h.snapshotCalls = [];
  h.breakdown = null;
});

function deferBreakdowns() {
  const pending: ((v: unknown) => void)[] = [];
  h.breakdown = () => new Promise((r) => { pending.push(r); });
  return () => pending.forEach((r) => r([{ stale: true }]));
}

type Props = Parameters<typeof useFinancialReportsData>[0];
const props = (over: Partial<Props> = {}): Props => ({
  active: true, leases, filteredLeases: leases, periodMode: 'year', periodStart: '2026-01-01', periodEnd: GOLDEN_AS_OF, ...lookups, ...over,
});

describe('useFinancialReportsData', () => {
  it('does not load while inactive', async () => {
    const p = props({ active: false });
    const { result } = renderHook(() => useFinancialReportsData(p));
    await act(async () => undefined);
    expect(h.snapshotCalls).toEqual([]);
    expect(result.current.balanceSheet).toBeNull();
    expect(result.current.ledgerPage).toBe(1);
    expect(result.current.ledgerPageSize).toBe(50);
  });

  it('loads statements and a monthly breakdown for a year period', async () => {
    const p = props();
    const { result } = renderHook(() => useFinancialReportsData(p));
    await waitFor(() => expect(result.current.profitLoss).not.toBeNull());
    expect(result.current.balanceSheet).not.toBeNull();
    expect(result.current.cashFlow).not.toBeNull();
    expect(result.current.balancesByType).not.toBeNull();
    expect(result.current.detailedLedger.length).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.monthReports).toHaveLength(9));
    expect(result.current.monthReportsLoading).toBe(false);
    expect(result.current.weekReports).toEqual([]);
  });

  it('scopes the ledger to the filtered leases', async () => {
    const p = props({ filteredLeases: [leases[0]], periodMode: 'date' as PeriodMode });
    const { result } = renderHook(() => useFinancialReportsData(p));
    await waitFor(() => expect(result.current.detailedLedger.length).toBeGreaterThan(0));
    const names = new Set(result.current.detailedLedger.map((e) => e.leaseName));
    expect(names).toEqual(new Set([leases[0].lease_name]));
  });

  it('loads a weekly breakdown for a month period', async () => {
    const p = props({ periodMode: 'month', periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    const { result } = renderHook(() => useFinancialReportsData(p));
    await waitFor(() => expect(result.current.weekReports.length).toBeGreaterThan(1));
    expect(result.current.weekReportsLoading).toBe(false);
    expect(result.current.monthReports).toEqual([]);
  });

  it('skips breakdowns for single-date mode', async () => {
    const p = props({ periodMode: 'date' as PeriodMode });
    const { result } = renderHook(() => useFinancialReportsData(p));
    await waitFor(() => expect(result.current.profitLoss).not.toBeNull());
    expect(result.current.monthReports).toEqual([]);
    expect(result.current.weekReports).toEqual([]);
    expect(result.current.monthReportsLoading).toBe(false);
    expect(result.current.weekReportsLoading).toBe(false);
  });

  it('clears everything (and resets the ledger page) when no leases match the filter', async () => {
    const { result, rerender } = renderHook((pp: Props) => useFinancialReportsData(pp), { initialProps: props() });
    await waitFor(() => expect(result.current.profitLoss).not.toBeNull());
    act(() => { result.current.setLedgerPage(4); result.current.setLedgerPageSize(100); });
    rerender(props({ filteredLeases: [] }));
    await waitFor(() => expect(result.current.profitLoss).toBeNull());
    expect(result.current.balanceSheet).toBeNull();
    expect(result.current.balancesByType).toBeNull();
    expect(result.current.cashFlow).toBeNull();
    expect(result.current.detailedLedger).toEqual([]);
    expect(result.current.monthReports).toEqual([]);
    expect(result.current.ledgerPage).toBe(1);
    expect(result.current.ledgerPageSize).toBe(100);
  });

  it('stops after the snapshot when there is no profit & loss', async () => {
    h.snapshot = async () => ({ balanceSheet: { x: 1 }, balancesByType: null, profitLoss: null, cashFlow: null, detailedLedger: [] });
    const p = props();
    const { result } = renderHook(() => useFinancialReportsData(p));
    await waitFor(() => expect(result.current.balanceSheet).toEqual({ x: 1 }));
    expect(result.current.monthReportsLoading).toBe(false);
    expect(result.current.monthReports).toEqual([]);
  });

  it('ignores a snapshot that resolves after the inputs changed', async () => {
    let release: (v: unknown) => void = () => undefined;
    h.snapshot = () => new Promise((r) => { release = r; });
    const { result, rerender } = renderHook((pp: Props) => useFinancialReportsData(pp), { initialProps: props() });
    rerender(props({ active: false }));
    await act(async () => { release({ balanceSheet: { stale: true }, balancesByType: null, profitLoss: {}, cashFlow: null, detailedLedger: [] }); });
    expect(result.current.balanceSheet).toBeNull();
  });

  it('ignores breakdowns that resolve after the inputs changed', async () => {
    const release = deferBreakdowns();
    const p = props();
    const { result, rerender } = renderHook((pp: Props) => useFinancialReportsData(pp), { initialProps: p });
    await waitFor(() => expect(result.current.monthReportsLoading).toBe(true));
    rerender(props({ active: false }));
    await act(async () => { release(); });
    expect(result.current.monthReports).toEqual([]);
    expect(result.current.monthReportsLoading).toBe(true);
  });

  it('ignores weekly breakdowns that resolve after the inputs changed', async () => {
    const release = deferBreakdowns();
    const p = props({ periodMode: 'month', periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    const { result, rerender } = renderHook((pp: Props) => useFinancialReportsData(pp), { initialProps: p });
    await waitFor(() => expect(result.current.weekReportsLoading).toBe(true));
    rerender({ ...p, active: false });
    await act(async () => { release(); });
    expect(result.current.weekReports).toEqual([]);
    expect(result.current.weekReportsLoading).toBe(true);
  });
});

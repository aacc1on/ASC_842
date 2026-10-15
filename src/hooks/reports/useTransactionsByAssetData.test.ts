import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

import { createFakeSupabase } from '../../test/fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_ORG, GOLDEN_USER, leaseId, type Row, type Tables } from '../../test/fixtures/goldenPortfolio';
import type { Lease } from '../../types/lease';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { useTransactionsByAssetData } from './useTransactionsByAssetData';

let tables: Tables;
let leases: Lease[];
let fake: ReturnType<typeof createFakeSupabase>;
let ranges: { table: string; from: number; to: number }[];

function install() {
  fake = createFakeSupabase(tables, { userId: GOLDEN_USER });
  ranges = [];
  h.client = {
    ...fake,
    from: (t: string) => {
      const q = fake.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const range = q.range.bind(q);
      q.range = (a: unknown, b: unknown) => { ranges.push({ table: t, from: a as number, to: b as number }); return range(a, b); };
      return q;
    },
  };
}

const monthDate = (i: number) => `${1950 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;

/** A synthetic lease with 1,250 monthly schedule rows (payment 1 each, ROU = remaining periods). */
function seedLongLease(): Lease {
  const lease = { ...leases[0], id: 'long-lease', lease_name: 'Long Lease', rou_asset: 2000 } as Lease;
  tables.leases.push(lease as unknown as Row);
  for (let i = 0; i < 1250; i++) {
    tables.amortization_schedules.push({
      id: `long-p${String(i + 1).padStart(4, '0')}`, lease_id: 'long-lease', organization_id: GOLDEN_ORG, period_number: i + 1,
      period_date: monthDate(i), beginning_liability: 0, payment_amount: 1, interest_expense: 0, principal_reduction: 0,
      ending_liability: 0, rou_asset_balance: 1250 - i, depreciation_expense: 1,
    });
  }
  return lease;
}

beforeEach(() => {
  const p = buildGoldenPortfolio();
  tables = p.tables;
  leases = p.leases;
  install();
});

describe('useTransactionsByAssetData', () => {
  it('does nothing while inactive or with no leases', async () => {
    const { result, rerender } = renderHook((p) => useTransactionsByAssetData(p), {
      initialProps: { active: false, filteredLeases: leases, periodStart: '2026-01-01', periodEnd: '2026-09-30' },
    });
    rerender({ active: true, filteredLeases: [], periodStart: '2026-01-01', periodEnd: '2026-09-30' });
    await act(async () => undefined);
    expect(result.current.assetTransactions).toEqual([]);
    expect(result.current.assetTxnLoading).toBe(false);
    expect(ranges).toEqual([]);
  });

  it('loads one row per lease, scoped to the filtered lease ids', async () => {
    const subset = leases.slice(0, 3);
    tables.amortization_schedules.push({ id: 'foreign', lease_id: 'other-org-lease', period_number: 1, period_date: '2026-01-01', rou_asset_balance: 1 });
    const { result } = renderHook(() => useTransactionsByAssetData({ active: true, filteredLeases: subset, periodStart: '2026-01-01', periodEnd: '2026-09-30' }));
    await waitFor(() => expect(result.current.assetTransactions).toHaveLength(3));
    expect(result.current.assetTxnLoading).toBe(false);
    expect(result.current.assetTransactions.map((r) => r.leaseId).sort()).toEqual([leaseId(1), leaseId(2), leaseId(3)]);
    // Default sort is lease name ascending.
    const names = result.current.sortedAssetTransactions.map((r) => r.leaseName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('pages over more than 1,000 schedule rows', async () => {
    const filteredLeases = [seedLongLease()];
    const { result } = renderHook(() => useTransactionsByAssetData({ active: true, filteredLeases, periodStart: '1900-01-01', periodEnd: '2100-12-31' }));
    await waitFor(() => expect(result.current.assetTransactions).toHaveLength(1));
    const row = result.current.assetTransactions[0];
    expect(row.leasePayment).toBe(1250);
    expect(row.endingRou).toBe(1);
    expect(ranges.filter((r) => r.table === 'amortization_schedules')).toEqual([
      { table: 'amortization_schedules', from: 0, to: 999 },
      { table: 'amortization_schedules', from: 1000, to: 1999 },
    ]);
  });

  it('loads a breakdown for a single lease column across >1,000 rows', async () => {
    const lease = seedLongLease();
    const { result } = renderHook(() => useTransactionsByAssetData({ active: false, filteredLeases: [lease], periodStart: '1900-01-01', periodEnd: '2100-12-31' }));
    await act(() => result.current.loadAssetBreakdown('long-lease', 'Long Lease', 'Lease Payment'));
    const bd = result.current.assetBreakdown!;
    expect(bd).toMatchObject({ leaseId: 'long-lease', leaseName: 'Long Lease', column: 'Lease Payment' });
    expect(bd.transactions).toHaveLength(1250);
    expect(bd.transactions[0]).toMatchObject({ date: '1950-01-01', type: 'period_1' });
    act(() => result.current.setAssetBreakdown(null));
    expect(result.current.assetBreakdown).toBeNull();
  });

  it('limits a breakdown to the selected period', async () => {
    const { result } = renderHook(() => useTransactionsByAssetData({ active: false, filteredLeases: leases, periodStart: '2026-01-01', periodEnd: '2026-03-31' }));
    await act(() => result.current.loadAssetBreakdown(leaseId(1), 'HQ', 'Interest Recognized'));
    expect(result.current.assetBreakdown!.transactions.map((t) => t.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('toggles sort direction on the same key and uses defaults for a new key', () => {
    const { result } = renderHook(() => useTransactionsByAssetData({ active: false, filteredLeases: [], periodStart: '2026-01-01', periodEnd: '2026-09-30' }));
    expect([result.current.assetSortKey, result.current.assetSortDir]).toEqual(['leaseName', 'asc']);
    act(() => result.current.handleAssetSort('leaseName'));
    expect(result.current.assetSortDir).toBe('desc');
    act(() => result.current.handleAssetSort('leaseName'));
    expect(result.current.assetSortDir).toBe('asc');
    act(() => result.current.handleAssetSort('endingRou'));
    expect([result.current.assetSortKey, result.current.assetSortDir]).toEqual(['endingRou', 'desc']);
    act(() => result.current.setAssetTxnFullscreen(true));
    expect(result.current.assetTxnFullscreen).toBe(true);
  });

  it('ignores results that arrive after the inputs changed', async () => {
    const { result, rerender } = renderHook((p) => useTransactionsByAssetData(p), {
      initialProps: { active: true, filteredLeases: leases.slice(0, 2), periodStart: '2026-01-01', periodEnd: '2026-09-30' },
    });
    rerender({ active: true, filteredLeases: leases.slice(0, 1), periodStart: '2026-01-01', periodEnd: '2026-09-30' });
    await waitFor(() => expect(result.current.assetTxnLoading).toBe(false));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.assetTransactions.map((r) => r.leaseId)).toEqual([leaseId(1)]);
  });

  it("only reads the current organization's schedules", async () => {
    tables.amortization_schedules.push({
      id: 'other-org-row', lease_id: leaseId(1), organization_id: 'other-org', period_number: 999,
      period_date: '2026-02-01', payment_amount: 1_000_000, rou_asset_balance: 0,
    });
    const { result } = renderHook(() => useTransactionsByAssetData({ active: false, filteredLeases: leases, periodStart: '2026-01-01', periodEnd: '2026-03-31' }));
    await act(() => result.current.loadAssetBreakdown(leaseId(1), 'HQ', 'Lease Payment'));
    expect(result.current.assetBreakdown!.transactions.every((t) => t.amount < 1_000_000)).toBe(true);
  });

  it('shows an error with a working retry when the schedules fail to load', async () => {
    fake.failures.select = { amortization_schedules: 'connection reset' };
    const firstTwo = leases.slice(0, 2);
    const { result } = renderHook(() => useTransactionsByAssetData({ active: true, filteredLeases: firstTwo, periodStart: '2026-01-01', periodEnd: '2026-09-30' }));
    await waitFor(() => {
      expect(result.current.assetTxnError).toBe('Failed to load asset transactions.');
      expect(result.current.assetTxnLoading).toBe(false);
    });
    expect(result.current.assetTransactions).toEqual([]);

    fake.failures.select = {};
    act(() => result.current.retryAssetTransactions());
    await waitFor(() => expect(result.current.assetTransactions).toHaveLength(2));
    expect(result.current.assetTxnError).toBeNull();
  });

  it('shows an error with a working retry when a breakdown fails to load', async () => {
    fake.failures.select = { amortization_schedules: 'timeout' };
    const { result } = renderHook(() => useTransactionsByAssetData({ active: false, filteredLeases: leases, periodStart: '2026-01-01', periodEnd: '2026-03-31' }));
    await act(() => result.current.loadAssetBreakdown(leaseId(1), 'HQ', 'Lease Payment'));
    expect(result.current.breakdownError?.message).toBe('Failed to load the transaction breakdown.');
    expect(result.current.assetBreakdown).toBeNull();

    fake.failures.select = {};
    await act(async () => { result.current.breakdownError!.retry(); });
    await waitFor(() => expect(result.current.assetBreakdown?.transactions).toHaveLength(3));
    expect(result.current.breakdownError).toBeNull();
  });

  it('drops an error from a request the user already moved away from', async () => {
    fake.failures.select = { amortization_schedules: 'slow failure' };
    const { result, rerender } = renderHook((p) => useTransactionsByAssetData(p), {
      initialProps: { active: true, filteredLeases: leases.slice(0, 2), periodStart: '2026-01-01', periodEnd: '2026-09-30' },
    });
    fake.failures.select = {};
    rerender({ active: true, filteredLeases: leases.slice(0, 1), periodStart: '2026-01-01', periodEnd: '2026-09-30' });
    await waitFor(() => expect(result.current.assetTransactions).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.assetTxnError).toBeNull();
    expect(result.current.assetTxnLoading).toBe(false);
  });
});

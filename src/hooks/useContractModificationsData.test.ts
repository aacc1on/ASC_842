import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useContractModificationsData } from './useContractModificationsData';
import { currentOrgId } from '../utils/currentOrg';

beforeEach(() => { vi.mocked(currentOrgId).mockResolvedValue('org-1'); });

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
let fromLog: string[];

function install(f: Fake) {
  fake = f;
  h.client = { ...f, from: (t: string) => { fromLog.push(t); return f.from(t); } };
}

beforeEach(() => {
  fromLog = [];
  tables = {
    leases: [
      { id: 'l2', organization_id: 'org-1', lease_name: 'Warehouse' },
      { id: 'l1', organization_id: 'org-1', lease_name: 'HQ' },
    ],
    contract_modifications: [
      {
        id: 'm1', lease_id: 'l1', modification_date: '2026-01-01', modification_type: 'term_extension', reason: 'r1',
        old_monthly_payment: '100', new_monthly_payment: 200, old_lease_term: 12, new_lease_term: 24,
        old_discount_rate: '5', new_discount_rate: 6, notes: 'note', status: 'approved',
      },
      {
        id: 'm2', lease_id: 'l2', modification_date: '2026-02-01', modification_type: 'payment_change', reason: 'r2',
        old_monthly_payment: null, new_monthly_payment: null, old_lease_term: null, new_lease_term: null,
        old_discount_rate: null, new_discount_rate: null, notes: null, status: 'pending_approval',
      },
      { id: 'm3', lease_id: 'other-org-lease', modification_date: '2026-03-01', status: 'approved' },
    ],
    contract_cancellations: [
      {
        id: 'c1', lease_id: 'l1', cancellation_date: '2026-05-01', cancellation_reason: 'exit', early_termination: 1,
        termination_penalty: '10', remaining_rou_asset: 1, remaining_lease_liability: 2, gain_loss_amount: 3,
        final_payment_amount: 4, settlement_details: 'paid', approved_by: 'u9', status: 'approved', derecognition_posted: true,
      },
      {
        id: 'c2', lease_id: 'l2', cancellation_date: '2026-06-01', cancellation_reason: 'x', early_termination: null,
        termination_penalty: null, remaining_rou_asset: null, remaining_lease_liability: null, gain_loss_amount: null,
        final_payment_amount: null, settlement_details: null, approved_by: null, status: 'pending_approval', derecognition_posted: null,
      },
      { id: 'c3', lease_id: 'other-org-lease', cancellation_date: '2026-07-01', status: 'approved' },
    ],
  } as unknown as Tables;
  install(createFakeSupabase(tables, { userId: 'u1' }));
});

describe('useContractModificationsData', () => {
  it('starts loading, then exposes leases, modifications and cancellations for visible leases only', async () => {
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const r = useContractModificationsData();
      seen.push(r.loading);
      return r;
    });
    await waitFor(() => expect(result.current.modifications).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen[0]).toBe(true);
    // loading is raised again once leases arrive and the dependent fetch starts
    expect(seen.lastIndexOf(true)).toBeGreaterThan(seen.indexOf(false));

    expect(result.current.leases.map((l) => l.id)).toEqual(['l1', 'l2']); // ordered by lease_name
    // newest first; the row for a lease outside the visible set is excluded
    expect(result.current.modifications.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(result.current.modifications[1]).toEqual({
      id: 'm1', lease_id: 'l1', modification_date: '2026-01-01', modification_type: 'term_extension', reason: 'r1',
      old_monthly_payment: 100, new_monthly_payment: 200, old_lease_term: 12, new_lease_term: 24,
      old_discount_rate: 5, new_discount_rate: 6, notes: 'note', status: 'approved', lease_name: 'HQ',
    });
    expect(result.current.modifications[0]).toMatchObject({
      old_monthly_payment: 0, new_monthly_payment: 0, old_lease_term: 0, new_lease_term: 0,
      old_discount_rate: undefined, new_discount_rate: undefined, notes: undefined, lease_name: 'Warehouse',
    });

    expect(result.current.cancellations.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(result.current.cancellations[1]).toMatchObject({
      early_termination: true, termination_penalty: 10, settlement_details: 'paid', approved_by: 'u9',
      derecognition_posted: true, lease_name: 'HQ',
    });
    expect(result.current.cancellations[0]).toMatchObject({
      early_termination: false, termination_penalty: 0, remaining_rou_asset: 0, remaining_lease_liability: 0,
      gain_loss_amount: 0, final_payment_amount: 0, settlement_details: undefined, approved_by: null,
      derecognition_posted: false, lease_name: 'Warehouse',
    });
  });

  it('leaves lease_name undefined when the joined lease is missing', async () => {
    tables.leases.push({ id: 'l3', lease_name: 'Ghost' });
    tables.contract_modifications.push({ id: 'm4', lease_id: 'l3', modification_date: '2025-01-01', status: 'draft' });
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.modifications).toHaveLength(3));
    // remove the lease after load so the join resolves to null on refetch
    tables.leases = tables.leases.filter((l) => l.id !== 'l3');
    act(() => result.current.loadData());
    await waitFor(() => expect(result.current.modifications.find((m) => m.id === 'm4')?.lease_name).toBeUndefined());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('with no leases, finishes loading with empty lists and never queries modifications', async () => {
    tables.leases = [];
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toEqual([]);
    expect(result.current.modifications).toEqual([]);
    expect(result.current.cancellations).toEqual([]);
    expect(fromLog).toEqual(['leases']);
  });

  it('reports a lease load failure and recovers on retry', async () => {
    fake.failures.select = { leases: 'boom' };
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toEqual([]);
    expect(result.current.modifications).toEqual([]);
    expect(fromLog).toEqual(['leases']);
    fake.failures.select = {};
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.modifications).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });

  it('reports a modifications error instead of showing empty lists, and retry recovers', async () => {
    fake.failures.select = { contract_modifications: 'denied' };
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.modifications).toEqual([]);
    fake.failures.select = {};
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.cancellations).toHaveLength(2));
    expect(result.current.modifications).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('reports a cancellations error', async () => {
    fake.failures.select = { contract_cancellations: 'denied' };
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cancellations).toEqual([]);
  });

  it('loadData refetches modifications and cancellations but not leases', async () => {
    const { result } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(result.current.cancellations).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fromLog.filter((t) => t === 'leases')).toHaveLength(1);

    tables.contract_modifications.push({ id: 'm9', lease_id: 'l1', modification_date: '2026-12-01', status: 'draft' });
    tables.contract_cancellations = [];
    act(() => result.current.loadData());
    await waitFor(() => expect(result.current.modifications[0]?.id).toBe('m9'));
    await waitFor(() => expect(result.current.cancellations).toEqual([]));
    expect(result.current.loading).toBe(false);
    expect(fromLog.filter((t) => t === 'leases')).toHaveLength(1);
    expect(fromLog.filter((t) => t === 'contract_modifications')).toHaveLength(2);
  });

  it('ignores results that arrive after unmount', async () => {
    const { result, unmount } = renderHook(() => useContractModificationsData());
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.leases).toEqual([]);
    expect(fromLog).toEqual(['leases']);
  });

  it('ignores a lease load failure that arrives after unmount', async () => {
    fake.failures.select = { leases: 'boom' };
    const { result, unmount } = renderHook(() => useContractModificationsData());
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.leases).toEqual([]);
  });

  it('stops after modifications if unmounted mid-load', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    h.client = {
      ...fake,
      from: (t: string) => {
        fromLog.push(t);
        const q = fake.from(t);
        if (t !== 'contract_modifications') return q;
        const wrapped = new Proxy(q, {
          get(target, prop) {
            const v = (target as unknown as Record<string | symbol, unknown>)[prop];
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => gate.then(() => target.then(ok, bad));
            }
            return typeof v === 'function' ? (...a: unknown[]) => { (v as (...x: unknown[]) => unknown).apply(target, a); return wrapped; } : v;
          },
        });
        return wrapped;
      },
    };
    const { result, unmount } = renderHook(() => useContractModificationsData());
    await waitFor(() => expect(fromLog).toContain('contract_modifications'));
    unmount();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(fromLog).not.toContain('contract_cancellations');
    expect(result.current.modifications).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});

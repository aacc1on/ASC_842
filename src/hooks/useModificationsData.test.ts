import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useModificationsData } from './useModificationsData';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

type Fake = ReturnType<typeof createFakeSupabase>;

let tables: Tables;
let fake: Fake;

function seed(): Tables {
  return {
    leases: [
      { id: 'L1', lease_name: 'Alpha', company_id: 'co-1' },
      { id: 'L2', lease_name: 'Beta', company_id: 'co-2' },
    ],
    contract_modifications: [
      {
        id: 'M1', lease_id: 'L1', modification_date: '2026-01-01', modification_type: 'term_extension', reason: 'a',
        old_monthly_payment: '100', new_monthly_payment: 200, old_lease_term: 12, new_lease_term: 24,
        old_discount_rate: '0.05', new_discount_rate: 0.06, accounting_treatment: 'remeasurement',
        remeasurement_required: true, notes: 'n', status: 'approved',
      },
      {
        id: 'M2', lease_id: 'L2', modification_date: '2026-03-01', modification_type: 'payment_change', reason: 'b',
        old_monthly_payment: null, new_monthly_payment: null, old_lease_term: null, new_lease_term: null,
        old_discount_rate: null, new_discount_rate: null, accounting_treatment: null,
        remeasurement_required: null, notes: null, status: 'pending_approval',
      },
      { id: 'M3', lease_id: 'OTHER', modification_date: '2026-02-01', status: 'approved' },
    ],
    contract_cancellations: [
      {
        id: 'C1', lease_id: 'L2', cancellation_date: '2026-04-01', cancellation_reason: 'exit',
        early_termination: 1, termination_penalty: '50', remaining_rou_asset: 10, remaining_lease_liability: 12,
        gain_loss_amount: 2, final_payment_amount: 0, settlement_details: null, approved_by: null,
        status: 'pending_approval', derecognition_posted: 0,
      },
      {
        id: 'C2', lease_id: 'L1', cancellation_date: '2026-05-01', cancellation_reason: 'done',
        early_termination: false, termination_penalty: null, remaining_rou_asset: null, remaining_lease_liability: null,
        gain_loss_amount: null, final_payment_amount: null, settlement_details: 'paid', approved_by: 'boss',
        status: 'approved', derecognition_posted: true,
      },
    ],
  };
}

beforeEach(() => {
  tables = seed();
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = fake as unknown as Record<string, unknown>;
});

async function loaded(companyId?: string | null) {
  const r = renderHook(() => useModificationsData(companyId));
  await waitFor(() => expect(r.result.current.leases.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r;
}

describe('useModificationsData', () => {
  it('loads, then maps modifications and cancellations for the loaded leases', async () => {
    const r = renderHook(() => useModificationsData());
    expect(r.result.current.loading).toBe(true);
    expect(r.result.current.modifications).toEqual([]);
    await waitFor(() => expect(r.result.current.modifications).toHaveLength(2));
    await waitFor(() => expect(r.result.current.loading).toBe(false));
    const { leases, modifications, cancellations, errorMessage } = r.result.current;

    expect(leases.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(errorMessage).toBe('');
    // newest first; rows for leases outside the list are not returned
    expect(modifications.map((m) => m.id)).toEqual(['M2', 'M1']);
    expect(modifications[1]).toMatchObject({
      lease_name: 'Alpha',
      old_monthly_payment: 100,
      old_discount_rate: 0.05,
      new_discount_rate: 0.06,
      remeasurement_required: true,
      notes: 'n',
      status: 'approved',
    });
    expect(modifications[0]).toMatchObject({
      lease_name: 'Beta',
      old_monthly_payment: 0,
      new_lease_term: 0,
      old_discount_rate: undefined,
      accounting_treatment: undefined,
      remeasurement_required: false,
      notes: undefined,
      status: 'pending_approval',
    });

    expect(cancellations.map((c) => c.id)).toEqual(['C2', 'C1']);
    expect(cancellations[1]).toMatchObject({
      lease_name: 'Beta',
      early_termination: true,
      termination_penalty: 50,
      derecognition_posted: false,
      settlement_details: undefined,
      approved_by: null,
      status: 'pending_approval',
    });
    expect(cancellations[0]).toMatchObject({
      termination_penalty: 0,
      remaining_rou_asset: 0,
      gain_loss_amount: 0,
      approved_by: 'boss',
      derecognition_posted: true,
    });
  });

  it('scopes leases and their records to the selected company', async () => {
    const { result } = await loaded('co-1');
    expect(result.current.leases.map((l) => l.id)).toEqual(['L1']);
    await waitFor(() => expect(result.current.modifications.map((m) => m.id)).toEqual(['M1']));
    expect(result.current.cancellations.map((c) => c.id)).toEqual(['C2']);
  });

  it('returns empty lists when there are no leases', async () => {
    tables.leases = [];
    const { result } = renderHook(() => useModificationsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leases).toEqual([]);
    expect(result.current.modifications).toEqual([]);
    expect(result.current.cancellations).toEqual([]);
    expect(result.current.errorMessage).toBe('');
  });

  it('returns empty lists when the selected company has no leases', async () => {
    const { result } = renderHook(() => useModificationsData('co-none'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.modifications).toEqual([]);
  });

  it('shows an error with a working retry when the lease list fails to load', async () => {
    fake.failures.select = { leases: 'boom' };
    const { result } = renderHook(() => useModificationsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorMessage).toBe('Failed to load leases.');
    expect(result.current.leases).toEqual([]);
    expect(result.current.modifications).toEqual([]);

    fake.failures.select = {};
    act(() => result.current.loadData());
    await waitFor(() => expect(result.current.modifications).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorMessage).toBe('');
    expect(result.current.leases.map((l) => l.id)).toEqual(['L1', 'L2']);
  });

  it("only reads the current organization's records", async () => {
    tables.leases.push({ id: 'L9', lease_name: 'Foreign', company_id: 'co-1', organization_id: 'other-org' });
    tables.contract_modifications.push({ id: 'M9', lease_id: 'L1', modification_date: '2026-06-01', status: 'approved', organization_id: 'other-org' });
    const { result } = await loaded();
    await waitFor(() => expect(result.current.modifications).toHaveLength(2));
    expect(result.current.leases.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(result.current.modifications.map((m) => m.id)).not.toContain('M9');
  });

  it('ignores a slower lease response for a company the user already switched away from', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const base = fake.from.bind(fake);
    let first = true;
    h.client = {
      ...fake,
      from: (t: string) => {
        const q = base(t) as unknown as Record<string, (...a: unknown[]) => unknown> & PromiseLike<unknown>;
        if (t !== 'leases' || !first) return q;
        first = false;
        const range = q.range.bind(q);
        q.range = (...a: unknown[]) => {
          const inner = range(...a) as PromiseLike<unknown>;
          return { then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => gate.then(() => inner.then(res, rej)) };
        };
        return q;
      },
    } as unknown as Record<string, unknown>;
    const { result, rerender } = renderHook(({ c }) => useModificationsData(c), { initialProps: { c: 'co-2' as string | null } });
    rerender({ c: 'co-1' });
    await waitFor(() => expect(result.current.leases.map((l) => l.id)).toEqual(['L1']));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.leases.map((l) => l.id)).toEqual(['L1']);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('shows a generic error when modifications fail but still loads cancellations', async () => {
    fake.failures.select = { contract_modifications: 'internal boom' };
    const { result } = await loaded();
    await waitFor(() => expect(result.current.errorMessage).toBe('Failed to load modifications.'));
    expect(result.current.modifications).toEqual([]);
    expect(result.current.cancellations).toHaveLength(2);
  });

  it('passes through a user-safe failure message', async () => {
    fake.failures.select = { contract_modifications: 'permission check failed' };
    const { result } = await loaded();
    await waitFor(() => expect(result.current.errorMessage).toBe('Failed to load modifications: permission check failed'));
  });

  it('shows an error when cancellations fail', async () => {
    fake.failures.select = { contract_cancellations: 'boom' };
    const { result } = await loaded();
    await waitFor(() => expect(result.current.errorMessage).toBe('Failed to load cancellations.'));
    expect(result.current.cancellations).toEqual([]);
    expect(result.current.modifications).toHaveLength(2);
  });

  it('loadData refetches and clears a previous error', async () => {
    fake.failures.select = { contract_cancellations: 'boom' };
    const { result } = await loaded();
    await waitFor(() => expect(result.current.errorMessage).toBe('Failed to load cancellations.'));

    fake.failures.select = {};
    tables.contract_modifications.push({ id: 'M4', lease_id: 'L1', modification_date: '2026-09-01', status: 'draft' });
    act(() => result.current.loadData());
    await waitFor(() => expect(result.current.modifications.map((m) => m.id)).toEqual(['M4', 'M2', 'M1']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorMessage).toBe('');
    expect(result.current.cancellations).toHaveLength(2);
  });

  it('exposes message setters', async () => {
    const { result } = await loaded();
    act(() => {
      result.current.setErrorMessage('err');
      result.current.setSuccessMessage('ok');
    });
    expect(result.current.errorMessage).toBe('err');
    expect(result.current.successMessage).toBe('ok');
  });

  it('does not update state after unmount', async () => {
    const r = await loaded();
    act(() => r.result.current.loadData());
    r.unmount();
    // a lease load in flight at unmount is also discarded
    const r2 = renderHook(() => useModificationsData());
    r2.unmount();
    fake.failures.select = { leases: 'boom' };
    const r3 = renderHook(() => useModificationsData());
    r3.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(r2.result.current.leases).toEqual([]);
    expect(r3.result.current.leases).toEqual([]);
  });
});

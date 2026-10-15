import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';

const h = vi.hoisted(() => ({
  client: null as unknown as Record<string, unknown>,
  finalize: null as unknown as (type: string, id: string, status: string) => Promise<boolean>,
}));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));
vi.mock('../utils/approvals', () => ({
  finalizeSavedItem: (type: string, id: string, status: string) => h.finalize(type, id, status),
}));

import { useImpairmentActions, type ImpairmentFormData } from './useImpairmentActions';

const LEASES = [
  { id: 'L1', organization_id: 'org-a', lease_name: 'Depot' },
  { id: 'L2', organization_id: 'org-b', lease_name: 'Other org' },
] as unknown as Lease[];

const FORM: ImpairmentFormData = { lease_id: 'L1', impairment_date: '2026-03-31', impairment_amount: 12345.6, reason: 'Closure' };

let tables: Tables;
let fake: ReturnType<typeof createFakeSupabase>;
let finalize: Mock<(type: string, id: string, status: string) => Promise<boolean>>;
let props: { leases: Lease[]; loadData: Mock<() => void>; setErrorMessage: Mock<(v: string) => void>; setSuccessMessage: Mock<(v: string) => void>; closeForm: Mock<() => void> };

const evt = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;
const last = (m: Mock<(v: string) => void>) => m.mock.calls[m.mock.calls.length - 1]?.[0];
const lastError = () => last(props.setErrorMessage);
const lastSuccess = () => last(props.setSuccessMessage);

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
}

beforeEach(() => {
  tables = { lease_impairments: [{ id: 'imp-1', lease_id: 'L1', organization_id: 'org-a', status: 'draft' } as Row] };
  install();
  finalize = vi.fn<(type: string, id: string, status: string) => Promise<boolean>>().mockResolvedValue(true);
  h.finalize = finalize;
  props = {
    leases: LEASES, loadData: vi.fn<() => void>(), setErrorMessage: vi.fn<(v: string) => void>(),
    setSuccessMessage: vi.fn<(v: string) => void>(), closeForm: vi.fn<() => void>(),
  };
});

const setup = () => renderHook(() => useImpairmentActions(props));

describe('useImpairmentActions.handleSubmit', () => {
  it.each([
    [{ lease_id: '' }, 'Please select a lease.'],
    [{ impairment_date: '' }, 'Please select an impairment date.'],
    [{ impairment_amount: 0 }, 'Impairment amount must be greater than zero.'],
    [{ impairment_amount: -5 }, 'Impairment amount must be greater than zero.'],
  ])('validates %o', async (patch, msg) => {
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), { ...FORM, ...patch }));
    expect(props.setErrorMessage).toHaveBeenNthCalledWith(1, '');
    expect(props.setSuccessMessage).toHaveBeenCalledWith('');
    expect(lastError()).toBe(msg);
    expect(fake.writes).toEqual([]);
  });

  it('creates a pending impairment scoped to the lease organization and reports approval', async () => {
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ op: 'insert', table: 'lease_impairments' });
    expect((fake.writes[0] as { rows: Row[] }).rows[0]).toEqual({
      organization_id: 'org-a', lease_id: 'L1', impairment_date: '2026-03-31', impairment_amount: 12345.6,
      reason: 'Closure', posted: false, status: 'pending_approval',
    });
    const newId = tables.lease_impairments[tables.lease_impairments.length - 1].id;
    expect(finalize).toHaveBeenCalledWith('impairment', newId, 'pending_approval');
    expect(lastSuccess()).toMatch(/sent for approval/);
    expect(props.closeForm).toHaveBeenCalledTimes(1);
    expect(props.loadData).toHaveBeenCalledTimes(1);
    expect(lastError()).toBe('');
  });

  it('reports a posted impairment with a formatted amount when approval is not required', async () => {
    finalize.mockResolvedValue(false);
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), { ...FORM, reason: '' }));
    expect((fake.writes[0] as { rows: Row[] }).rows[0].reason).toBeNull();
    expect(lastSuccess()).toBe('Impairment of $12,345.60 posted to the ledger.');
  });

  it('leaves organization undefined for a lease outside the loaded list', async () => {
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), { ...FORM, lease_id: 'L-unknown' }));
    expect((fake.writes[0] as { rows: Row[] }).rows[0].organization_id).toBeUndefined();
  });

  it('maps a permission error code to a safe message and does not finalize', async () => {
    h.client = {
      ...fake,
      from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'new row violates row-level security', code: '42501' } }) }) }) }),
    };
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(lastError()).toMatch(/do not have permission/);
    expect(finalize).not.toHaveBeenCalled();
    expect(props.closeForm).not.toHaveBeenCalled();
    expect(props.loadData).not.toHaveBeenCalled();
  });

  it('uses the fallback when the insert fails with an internal error', async () => {
    install({ failures: { write: { lease_impairments: 'null value in column "x"' } } });
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(lastError()).toBe('Failed to create impairment record.');
  });

  it('surfaces a closed-period guard raised while posting', async () => {
    finalize.mockRejectedValue(new Error('Cannot post to a closed accounting period.'));
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(lastError()).toBe('Cannot post to a closed accounting period.');
    expect(props.closeForm).not.toHaveBeenCalled();
  });

  it('uses the save fallback for unexpected thrown errors', async () => {
    finalize.mockRejectedValue(new Error('pg_catalog: stack overflow'));
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(lastError()).toBe('Failed to save impairment.');
  });
});

describe('useImpairmentActions.handleDelete', () => {
  it('deletes by id and reloads', async () => {
    const { result } = setup();
    await act(() => result.current.handleDelete('imp-1'));
    expect(fake.writes).toEqual([{ op: 'delete', table: 'lease_impairments', matched: 1 }]);
    expect(tables.lease_impairments).toHaveLength(0);
    expect(lastSuccess()).toBe('Impairment record deleted.');
    expect(props.loadData).toHaveBeenCalledTimes(1);
  });

  it('surfaces a posted-entry guard error', async () => {
    install({ failures: { write: { lease_impairments: 'Posted entries cannot be deleted.' } } });
    const { result } = setup();
    await act(() => result.current.handleDelete('imp-1'));
    expect(lastError()).toBe('Posted entries cannot be deleted.');
    expect(props.loadData).not.toHaveBeenCalled();
  });

  it('uses the fallback when the client throws', async () => {
    h.client = { ...fake, from: () => { throw new Error('boom'); } };
    const { result } = setup();
    await act(() => result.current.handleDelete('imp-1'));
    expect(lastError()).toBe('Failed to delete impairment.');
  });
});

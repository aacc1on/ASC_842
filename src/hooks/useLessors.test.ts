import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useLessors, type LessorFormData } from './useLessors';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

let tables: Tables;
let fake: ReturnType<typeof createFakeSupabase>;

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
}

async function mounted() {
  const hook = renderHook(() => useLessors());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const form = (over: Partial<LessorFormData> = {}): LessorFormData => ({
  lessor_name: '  Landlord LLC ', lessor_type: 'corporate', contact_email: '  ', contact_phone: ' 555 ',
  address: '', is_active: true, notes: '  note ', ...over,
});

beforeEach(() => {
  tables = {
    lessors: [
      { id: 'l-b', lessor_name: 'Beta Props', is_active: true },
      { id: 'l-a', lessor_name: 'Acme Realty', is_active: true },
    ],
  };
  setup();
});

describe('useLessors – loading', () => {
  it('loads on mount sorted by name', async () => {
    const hook = renderHook(() => useLessors());
    expect(hook.result.current.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.lessors.map((l) => l.id)).toEqual(['l-a', 'l-b']);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.EMPTY_FORM).toMatchObject({ lessor_name: '', lessor_type: 'corporate', is_active: true });
  });

  it('handles an empty table', async () => {
    tables.lessors = [];
    const { result } = await mounted();
    expect(result.current.lessors).toEqual([]);
  });

  it('shows the fallback on a load error', async () => {
    setup({ failures: { select: { lessors: 'permission denied for table lessors' } } });
    const { result } = await mounted();
    expect(result.current.error).toBe('Failed to load lessors');
    expect(result.current.lessors).toEqual([]);
  });
});

describe('useLessors – saveLessor', () => {
  it('inserts a trimmed payload with empty strings nulled, then reloads', async () => {
    const { result } = await mounted();
    let ok = false;
    await act(async () => { ok = await result.current.saveLessor(form()); });
    expect(ok).toBe(true);
    expect(fake.writes[0]).toEqual({
      op: 'insert', table: 'lessors',
      rows: [{ lessor_name: 'Landlord LLC', lessor_type: 'corporate', contact_email: null, contact_phone: '555', address: null, is_active: true, notes: 'note' }],
    });
    expect(result.current.lessors.map((l) => l.lessor_name)).toEqual(['Acme Realty', 'Beta Props', 'Landlord LLC']);
    expect(result.current.saving).toBe(false);
  });

  it('updates an existing lessor by id', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.saveLessor(form({ lessor_name: 'Acme 2', notes: '', contact_email: 'a@b.c' }), 'l-a'); });
    expect(fake.writes[0]).toMatchObject({ op: 'update', table: 'lessors', matched: 1, values: { lessor_name: 'Acme 2', notes: null, contact_email: 'a@b.c' } });
    expect(result.current.lessors.find((l) => l.id === 'l-a')?.lessor_name).toBe('Acme 2');
  });

  it('returns false and sets an error when the insert fails', async () => {
    const { result } = await mounted();
    fake.failures.write = { lessors: 'duplicate key value violates unique constraint' };
    let ok = true;
    await act(async () => { ok = await result.current.saveLessor(form()); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to save lessor');
    expect(result.current.saving).toBe(false);
  });

  it('returns false when the update fails', async () => {
    const { result } = await mounted();
    fake.failures.write = { lessors: 'x' };
    let ok = true;
    await act(async () => { ok = await result.current.saveLessor(form(), 'l-a'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to save lessor');
  });
});

describe('useLessors – toggleActive / deleteLessor', () => {
  it('toggles active state locally after a successful update', async () => {
    const { result } = await mounted();
    let ok = false;
    await act(async () => { ok = await result.current.toggleActive('l-b', false); });
    expect(ok).toBe(true);
    expect(fake.writes[0]).toEqual({ op: 'update', table: 'lessors', values: { is_active: false }, matched: 1 });
    expect(result.current.lessors.find((l) => l.id === 'l-b')?.is_active).toBe(false);
    expect(result.current.lessors.find((l) => l.id === 'l-a')?.is_active).toBe(true);
  });

  it('reports toggle failures and leaves state unchanged', async () => {
    const { result } = await mounted();
    fake.failures.write = { lessors: 'x' };
    let ok = true;
    await act(async () => { ok = await result.current.toggleActive('l-b', false); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to update lessor');
    expect(result.current.lessors.find((l) => l.id === 'l-b')?.is_active).toBe(true);
  });

  it('deletes and removes the lessor locally', async () => {
    const { result } = await mounted();
    let ok = false;
    await act(async () => { ok = await result.current.deleteLessor('l-a'); });
    expect(ok).toBe(true);
    expect(fake.writes[0]).toEqual({ op: 'delete', table: 'lessors', matched: 1 });
    expect(result.current.lessors.map((l) => l.id)).toEqual(['l-b']);
  });

  it('maps an FK violation on delete to the friendly message', async () => {
    const { result } = await mounted();
    h.client = {
      from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: 'violates foreign key', code: '23503' } }) }) }),
    };
    let ok = true;
    await act(async () => { ok = await result.current.deleteLessor('l-a'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('A required related record was not found. Check your selections and try again.');
    expect(result.current.lessors).toHaveLength(2);
  });

  it('uses the delete fallback for unknown errors', async () => {
    const { result } = await mounted();
    fake.failures.write = { lessors: 'x' };
    await act(async () => { await result.current.deleteLessor('l-a'); });
    expect(result.current.error).toBe('Failed to delete lessor');
  });
});

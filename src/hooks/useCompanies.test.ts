import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { currentOrgId } from '../utils/currentOrg';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useCompanies } from './useCompanies';

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

beforeEach(() => {
  localStorage.clear();
  tables = {
    companies: [
      { id: 'c-zeta', company_name: 'Zeta', is_active: true },
      { id: 'c-alpha', company_name: 'Alpha', is_active: true },
      { id: 'c-old', company_name: 'Archived', is_active: false },
    ],
  };
  setup();
});

describe('useCompanies – loadCompanies', () => {
  it('starts loading and not loaded (no auto-load)', () => {
    const { result } = renderHook(() => useCompanies());
    expect(result.current.loading).toBe(true);
    expect(result.current.loaded).toBe(false);
    expect(result.current.companies).toEqual([]);
  });

  it('loads active companies sorted by name and selects the first', async () => {
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.companies.map((c) => c.id)).toEqual(['c-alpha', 'c-zeta']);
    expect(result.current.selectedCompanyId).toBe('c-alpha');
    expect(result.current.loaded).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('restores a persisted selection when it is still available', async () => {
    localStorage.setItem('selectedCompanyId', 'c-zeta');
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.selectedCompanyId).toBe('c-zeta');
  });

  it('ignores a persisted selection for an inactive / foreign company', async () => {
    localStorage.setItem('selectedCompanyId', 'c-old');
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.selectedCompanyId).toBe('c-alpha');
  });

  it('handles no companies', async () => {
    tables.companies = [];
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.companies).toEqual([]);
    expect(result.current.selectedCompanyId).toBeNull();
    expect(result.current.loaded).toBe(true);
  });

  it('reports a query error, ends loading, and clears the error on a successful retry', async () => {
    setup({ failures: { select: { companies: 'boom' } } });
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.companies).toEqual([]);
    expect(result.current.error).toBeTruthy();
    expect(result.current.loaded).toBe(true);
    expect(result.current.loading).toBe(false);
    delete fake.failures.select!.companies;
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.error).toBeNull();
    expect(result.current.companies.length).toBeGreaterThan(0);
  });

  it('ends loading with an error when the organization cannot be resolved', async () => {
    setup();
    vi.mocked(currentOrgId).mockRejectedValueOnce(new Error('Your account is not linked to an organization.'));
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeTruthy();
  });

  it('finishes loading without querying when signed out', async () => {
    setup({ signedOut: true });
    const from = vi.spyOn(fake, 'from');
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    expect(from).not.toHaveBeenCalled();
    expect(result.current.loaded).toBe(true);
    expect(result.current.loading).toBe(false);
  });
});

describe('useCompanies – mutations and selection', () => {
  it('handleAddCompany inserts trimmed values and nulls an empty code', async () => {
    const { result } = renderHook(() => useCompanies());
    let ok = false;
    await act(async () => { ok = await result.current.handleAddCompany('  New Co ', '   '); });
    expect(ok).toBe(true);
    await act(async () => { ok = await result.current.handleAddCompany('Other', ' OC1 '); });
    expect(fake.writes).toEqual([
      { op: 'insert', table: 'companies', rows: [{ company_name: 'New Co', company_code: null }] },
      { op: 'insert', table: 'companies', rows: [{ company_name: 'Other', company_code: 'OC1' }] },
    ]);
    // insert only; list is not refreshed by the hook
    expect(result.current.companies).toEqual([]);
  });

  it('handleAddCompany rejects blank names without a write', async () => {
    const { result } = renderHook(() => useCompanies());
    let ok = true;
    await act(async () => { ok = await result.current.handleAddCompany('   ', 'X'); });
    expect(ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it('handleAddCompany returns false on insert error', async () => {
    setup({ failures: { write: { companies: 'denied' } } });
    const { result } = renderHook(() => useCompanies());
    let ok = true;
    await act(async () => { ok = await result.current.handleAddCompany('X', ''); });
    expect(ok).toBe(false);
  });

  it('handleCompanyChange persists and clears the selection', () => {
    const { result } = renderHook(() => useCompanies());
    act(() => result.current.handleCompanyChange('c-zeta'));
    expect(result.current.selectedCompanyId).toBe('c-zeta');
    expect(localStorage.getItem('selectedCompanyId')).toBe('c-zeta');
    act(() => result.current.handleCompanyChange(null));
    expect(result.current.selectedCompanyId).toBeNull();
    expect(localStorage.getItem('selectedCompanyId')).toBeNull();
  });

  it('setSelectedCompanyId updates state without persisting', () => {
    const { result } = renderHook(() => useCompanies());
    act(() => result.current.setSelectedCompanyId('c-alpha'));
    expect(result.current.selectedCompanyId).toBe('c-alpha');
    expect(localStorage.getItem('selectedCompanyId')).toBeNull();
  });

  it('reset clears state and persisted selection', async () => {
    const { result } = renderHook(() => useCompanies());
    await act(async () => { await result.current.loadCompanies(); });
    act(() => result.current.handleCompanyChange('c-zeta'));
    act(() => result.current.reset());
    expect(result.current.companies).toEqual([]);
    expect(result.current.selectedCompanyId).toBeNull();
    expect(result.current.loaded).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(localStorage.getItem('selectedCompanyId')).toBeNull();
  });
});

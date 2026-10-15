import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { findDuplicateAssetClass, usePolicyElections } from './usePolicyElections';
import type { AssetTypeInfo } from '../utils/policyElections';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';

type Fake = ReturnType<typeof createFakeSupabase>;
type Outcome = { data?: unknown; error?: { message: string; code?: string } | null; reject?: unknown };

/** A builder whose every chained call returns itself and which settles to `outcome`. */
function stubChain(outcome: Outcome) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'single', 'maybeSingle']) {
    chain[m] = () => chain;
  }
  chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
    (outcome.reject !== undefined
      ? Promise.reject(outcome.reject)
      : Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
    ).then(ok, fail);
  return chain;
}

let tables: Tables;
let fake: Fake;
/** Per-table overrides of the next write (insert/update) result. */
let writeOverride: Record<string, Outcome>;
let fromLog: string[];

function install(opts: { signedOut?: boolean } = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', signedOut: opts.signedOut });
  h.client = {
    ...fake,
    from: (table: string) => {
      fromLog.push(table);
      const q = fake.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const o = writeOverride[table];
      if (!o) return q;
      return new Proxy(q, {
        get(t, p: string) {
          if (p === 'insert' || p === 'update') return () => stubChain(o);
          const v = t[p];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    },
  };
}

function election(over: Row = {}): Row {
  return {
    id: 'e1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
    election_value: true, effective_from: '2024-01-01', effective_to: null, status: 'approved',
    policy_version: 1, notes: null, change_reason: null, prepared_by: null, approved_by: null,
    created_at: '2024-01-01T00:00:00Z', ...over,
  };
}

beforeEach(() => {
  writeOverride = {};
  fromLog = [];
  tables = {
    companies: [
      { id: 'c2', company_name: 'Zeta Co', entity_type: null, is_active: true },
      { id: 'c1', company_name: 'Acme', entity_type: 'public_business_entity', is_active: true },
      { id: 'c3', company_name: 'Archived', entity_type: null, is_active: false },
    ],
    fixed_asset_types: [
      { id: 'a2', type_name: 'Vehicles', is_active: true },
      { id: 'a1', type_name: 'Buildings', is_active: true },
      { id: 'a3', type_name: 'Old Gear', is_active: false },
    ],
    accounting_policy_elections: [
      election({ id: 'e1', created_at: '2024-01-01T00:00:00Z' }),
      election({ id: 'e2', created_at: '2024-02-01T00:00:00Z', status: 'draft' }),
      election({ id: 'eX', company_id: 'c2' }),
    ],
  };
});

async function renderLoaded() {
  const r = renderHook(() => usePolicyElections());
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  await waitFor(() => expect(r.result.current.elections.length).toBeGreaterThan(0));
  return r;
}

describe('findDuplicateAssetClass', () => {
  const types: AssetTypeInfo[] = [{ id: 'a1', type_name: ' Buildings ', is_active: true }];
  it('matches case- and whitespace-insensitively', () => {
    expect(findDuplicateAssetClass(types, 'buildings  ')?.id).toBe('a1');
    expect(findDuplicateAssetClass(types, 'Vehicles')).toBeUndefined();
  });
});

describe('usePolicyElections loading', () => {
  it('starts loading, then loads active companies sorted, asset types, and selects the first company', async () => {
    install();
    const { result } = renderHook(() => usePolicyElections());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.companies.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result.current.assetTypes.map((a) => a.type_name)).toEqual(['Buildings', 'Old Gear', 'Vehicles']);
    expect(result.current.selectedCompanyId).toBe('c1');
    expect(result.current.selectedCompany?.company_name).toBe('Acme');
    await waitFor(() => expect(result.current.elections.map((e) => e.id)).toEqual(['e2', 'e1']));
  });

  it('scopes elections to the selected company and refetches when it changes', async () => {
    install();
    const { result } = await renderLoaded();
    expect(result.current.elections.every((e) => e.company_id === 'c1')).toBe(true);
    act(() => result.current.setSelectedCompanyId('c2'));
    await waitFor(() => expect(result.current.elections.map((e) => e.id)).toEqual(['eX']));
    expect(result.current.selectedCompany?.id).toBe('c2');
  });

  it('clears elections when no company is selected', async () => {
    install();
    const { result } = await renderLoaded();
    act(() => result.current.setSelectedCompanyId(null));
    await waitFor(() => expect(result.current.elections).toEqual([]));
    expect(result.current.selectedCompany).toBeNull();
  });

  it('handles an empty tenant (no companies, no asset types)', async () => {
    tables.companies = [];
    tables.fixed_asset_types = [];
    install();
    const { result } = renderHook(() => usePolicyElections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.companies).toEqual([]);
    expect(result.current.assetTypes).toEqual([]);
    expect(result.current.selectedCompanyId).toBeNull();
    expect(result.current.elections).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(fromLog).not.toContain('accounting_policy_elections');
  });

  it('reports a companies load failure with the fallback (internal detail hidden)', async () => {
    install();
    fake.failures.select = { companies: 'relation "companies" does not exist' };
    const { result } = renderHook(() => usePolicyElections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load data');
    expect(result.current.companies).toEqual([]);
  });

  it('reports an asset types load failure', async () => {
    install();
    fake.failures.select = { fixed_asset_types: 'boom' };
    const { result } = renderHook(() => usePolicyElections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load data');
  });

  it('reports an elections load failure', async () => {
    install();
    fake.failures.select = { accounting_policy_elections: 'boom' };
    const { result } = renderHook(() => usePolicyElections());
    await waitFor(() => expect(result.current.error).toBe('Failed to load elections'));
    expect(result.current.elections).toEqual([]);
  });

  it('reload refetches elections', async () => {
    install();
    const { result } = await renderLoaded();
    tables.accounting_policy_elections.push(election({ id: 'e3', created_at: '2025-01-01T00:00:00Z' }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.elections[0].id).toBe('e3'));
  });
});

describe('saveElection', () => {
  const params = {
    fixedAssetTypeId: 'a1', policyType: 'SHORT_TERM_LEASE' as const, electionValue: true,
    effectiveFrom: '2025-01-01',
  };

  it('inserts a pending_approval election for the selected company and reloads', async () => {
    install();
    const { result } = await renderLoaded();
    let res: Awaited<ReturnType<typeof result.current.saveElection>> = { success: false };
    await act(async () => {
      res = await result.current.saveElection({ ...params, notes: 'n', changeReason: 'why', supportingDocumentId: 'd1' });
    });
    expect(res.success).toBe(true);
    expect(res.status).toBe('pending_approval');
    expect(res.id).toBeTruthy();
    const w = fake.writes.find((x) => x.op === 'insert' && x.table === 'accounting_policy_elections');
    expect(w && 'rows' in w ? w.rows[0] : null).toMatchObject({
      company_id: 'c1', fixed_asset_type_id: 'a1', status: 'pending_approval', policy_version: 0,
      notes: 'n', change_reason: 'why', supporting_document_id: 'd1',
    });
    await waitFor(() => expect(result.current.elections.some((e) => e.id === res.id)).toBe(true));
  });

  it('defaults optional fields to null', async () => {
    install();
    const { result } = await renderLoaded();
    await act(async () => { await result.current.saveElection(params); });
    const w = fake.writes.find((x) => x.op === 'insert');
    expect(w && 'rows' in w ? w.rows[0] : null).toMatchObject({ notes: null, change_reason: null, supporting_document_id: null });
  });

  it('refuses when no company is selected', async () => {
    install();
    const { result } = await renderLoaded();
    act(() => result.current.setSelectedCompanyId(null));
    let res: { success: boolean } = { success: true };
    await act(async () => { res = await result.current.saveElection(params); });
    expect(res).toEqual({ success: false });
    expect(fake.writes).toEqual([]);
  });

  it('surfaces a guard message from the database', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.accounting_policy_elections = { error: { message: 'Only pending elections can be approved' } };
    let res: { success: boolean } = { success: true };
    await act(async () => { res = await result.current.saveElection(params); });
    expect(res).toEqual({ success: false });
    expect(result.current.error).toBe('Only pending elections can be approved');
  });

  it('hides internal error detail', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.accounting_policy_elections = { error: { message: 'new row violates row-level security policy' } };
    await act(async () => { await result.current.saveElection(params); });
    expect(result.current.error).toBe(GENERIC);
  });

  it('handles a thrown error with the fallback', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.accounting_policy_elections = { reject: new Error('') };
    let res: { success: boolean } = { success: true };
    await act(async () => { res = await result.current.saveElection(params); });
    expect(res).toEqual({ success: false });
    expect(result.current.error).toBe('Failed to save election');
  });
});

describe('submitForApproval', () => {
  it('moves the election to pending_approval and reloads', async () => {
    install();
    const { result } = await renderLoaded();
    let ok = false;
    await act(async () => { ok = await result.current.submitForApproval('e2'); });
    expect(ok).toBe(true);
    expect(tables.accounting_policy_elections.find((e) => e.id === 'e2')?.status).toBe('pending_approval');
    await waitFor(() =>
      expect(result.current.elections.find((e) => e.id === 'e2')?.status).toBe('pending_approval'));
  });

  it('returns false and shows the guard message on failure', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.accounting_policy_elections = { error: { message: 'Election is not pending approval' } };
    let ok = true;
    await act(async () => { ok = await result.current.submitForApproval('e2'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Election is not pending approval');
  });

  it('returns false on a thrown error', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.accounting_policy_elections = { reject: 'x' };
    let ok = true;
    await act(async () => { ok = await result.current.submitForApproval('e2'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to submit');
  });
});

describe('setCompanyEntityType', () => {
  it('updates the company and local state', async () => {
    install();
    const { result } = await renderLoaded();
    let ok = false;
    await act(async () => { ok = await result.current.setCompanyEntityType('c1', 'non_public_business_entity'); });
    expect(ok).toBe(true);
    expect(result.current.selectedCompany?.entity_type).toBe('non_public_business_entity');
    expect(result.current.companies.find((c) => c.id === 'c2')?.entity_type).toBeNull();
    expect(tables.companies.find((c) => c.id === 'c1')?.entity_type).toBe('non_public_business_entity');
  });

  it('keeps state on error', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.companies = { error: { message: 'Public business entities cannot use this' } };
    let ok = true;
    await act(async () => { ok = await result.current.setCompanyEntityType('c1', null); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Public business entities cannot use this');
    expect(result.current.selectedCompany?.entity_type).toBe('public_business_entity');
  });

  it('returns false on a thrown error', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.companies = { reject: new Error('kaput') };
    let ok = true;
    await act(async () => { ok = await result.current.setCompanyEntityType('c1', null); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to update entity type');
  });
});

describe('createAssetClassWithPolicies', () => {
  const base = {
    typeName: '  Equipment ', typeCode: ' EQ ', effectiveFrom: '2025-01-01', notes: '  note ',
    policies: [
      { policyType: 'SHORT_TERM_LEASE' as const, electionValue: true },
      { policyType: 'COMBINE_LEASE_NONLEASE' as const, electionValue: false },
    ],
  };
  type Res = Awaited<ReturnType<ReturnType<typeof usePolicyElections>['createAssetClassWithPolicies']>>;

  async function create(result: { current: ReturnType<typeof usePolicyElections> }, p = base) {
    let res: Res | null = null;
    await act(async () => { res = await result.current.createAssetClassWithPolicies(p); });
    return res as unknown as Res;
  }

  it('creates the asset class and pending elections for the selected company', async () => {
    install();
    const { result } = await renderLoaded();
    const res = await create(result);
    expect(res).toEqual({ ok: true, policiesSaved: true });
    expect(result.current.assetTypes.map((a) => a.type_name)).toEqual(['Buildings', 'Equipment', 'Old Gear', 'Vehicles']);
    const assetWrite = fake.writes.find((w) => w.table === 'fixed_asset_types');
    expect(assetWrite && 'rows' in assetWrite ? assetWrite.rows[0] : null)
      .toEqual({ user_id: 'u1', type_name: 'Equipment', type_code: 'EQ', is_active: true });
    const elecWrite = fake.writes.find((w) => w.table === 'accounting_policy_elections');
    const rows = elecWrite && 'rows' in elecWrite ? elecWrite.rows : [];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.company_id === 'c1' && r.status === 'pending_approval' && r.notes === 'note')).toBe(true);
  });

  it('skips the elections insert when no policies are given', async () => {
    install();
    const { result } = await renderLoaded();
    const res = await create(result, { ...base, notes: undefined as unknown as string, policies: [] });
    expect(res).toEqual({ ok: true, policiesSaved: true });
    expect(fake.writes.filter((w) => w.table === 'accounting_policy_elections')).toEqual([]);
  });

  it('stores blank notes as null', async () => {
    install();
    const { result } = await renderLoaded();
    await create(result, { ...base, notes: '   ' });
    const elecWrite = fake.writes.find((w) => w.table === 'accounting_policy_elections');
    expect(elecWrite && 'rows' in elecWrite ? elecWrite.rows[0].notes : 'x').toBeNull();
  });

  it('reports policiesSaved=false when the elections insert fails', async () => {
    install();
    const { result } = await renderLoaded();
    fake.failures.write = { accounting_policy_elections: 'nope' };
    const res = await create(result);
    expect(res).toEqual({ ok: true, policiesSaved: false });
  });

  it('requires a selected company', async () => {
    install();
    const { result } = await renderLoaded();
    act(() => result.current.setSelectedCompanyId(null));
    expect(await create(result)).toEqual({ ok: false, duplicate: false, message: 'Select a company first.' });
  });

  it('flags an existing (inactive) class as a duplicate without writing', async () => {
    install();
    const { result } = await renderLoaded();
    expect(await create(result, { ...base, typeName: 'old gear' }))
      .toEqual({ ok: false, duplicate: true, message: 'Asset class "Old Gear" already exists (inactive).' });
    expect(await create(result, { ...base, typeName: 'BUILDINGS' }))
      .toEqual({ ok: false, duplicate: true, message: 'Asset class "Buildings" already exists.' });
    expect(fake.writes).toEqual([]);
  });

  it('asks to sign in again when the session has expired', async () => {
    install({ signedOut: true });
    const { result } = await renderLoaded();
    expect(await create(result))
      .toEqual({ ok: false, duplicate: false, message: 'Your session has expired. Please sign in again.' });
  });

  it('maps a unique violation (23505) to a duplicate', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.fixed_asset_types = { error: { message: 'duplicate key', code: '23505' } };
    expect(await create(result))
      .toEqual({ ok: false, duplicate: true, message: 'Asset class "Equipment" already exists.' });
  });

  it('returns a safe message for other insert errors', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.fixed_asset_types = { error: { message: 'violates check constraint' } };
    expect(await create(result))
      .toEqual({ ok: false, duplicate: false, message: 'Failed to create asset class' });
  });

  it('returns the fallback when the insert throws', async () => {
    install();
    const { result } = await renderLoaded();
    writeOverride.fixed_asset_types = { reject: new Error('') };
    expect(await create(result))
      .toEqual({ ok: false, duplicate: false, message: 'Failed to create asset class' });
  });
});

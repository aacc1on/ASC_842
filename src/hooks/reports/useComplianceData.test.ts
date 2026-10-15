import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

import { createFakeSupabase } from '../../test/fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_AS_OF, GOLDEN_USER, leaseId, type Tables } from '../../test/fixtures/goldenPortfolio';
import type { Lease } from '../../types/lease';

const h = vi.hoisted(() => ({
  client: null as unknown as Record<string, unknown>,
  /** When set, computeMaturityAnalysis rejects with this error (exercises the silent catch). */
  maturityError: null as Error | null,
}));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));
vi.mock('../../utils/financialReports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/financialReports')>();
  return {
    ...actual,
    computeMaturityAnalysis: (...a: Parameters<typeof actual.computeMaturityAnalysis>) =>
      (h.maturityError ? Promise.reject(h.maturityError) : actual.computeMaturityAnalysis(...a)),
  };
});

import { useComplianceData } from './useComplianceData';

let tables: Tables;
let leases: Lease[];
let fake: ReturnType<typeof createFakeSupabase>;

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: GOLDEN_USER, ...opts });
  h.client = fake as unknown as Record<string, unknown>;
}

beforeEach(() => {
  const p = buildGoldenPortfolio();
  tables = p.tables;
  leases = p.leases;
  h.maturityError = null;
  const mod = tables.contract_modifications[0];
  tables.contract_modifications.push(
    // A later reassessment for the same lease wins.
    { ...mod, id: 'mod-2', modification_date: '2026-02-01', new_lease_term: 60 },
    // Not yet approved / not posted / no reassessment: ignored.
    { ...mod, id: 'mod-3', lease_id: leaseId(1), status: 'pending_approval' },
    { ...mod, id: 'mod-4', lease_id: leaseId(2), accounting_posted: false },
    { ...mod, id: 'mod-5', lease_id: leaseId(3), reassessed_classification: null },
    // Another organization's lease is never requested.
    { ...mod, id: 'mod-x', lease_id: 'other-org-lease', organization_id: 'org-b' },
  );
  install();
});

describe('useComplianceData', () => {
  it('loads the latest posted reassessment per lease and computes disclosures', async () => {
    const { result } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    // Only active leases overlapping the period.
    expect(result.current.activeLeases.every((l) => l.status === 'active')).toBe(true);
    expect(result.current.activeLeases.map((l) => l.id)).not.toContain(leaseId(9));
    expect(result.current.activeLeases.map((l) => l.id)).not.toContain(leaseId(8));

    await waitFor(() => expect(result.current.reassessments.size).toBe(1));
    expect(result.current.reassessments.get(leaseId(6))).toMatchObject({ new_lease_term: 60, modification_date: '2026-02-01' });
    expect(result.current.reassessments.has('other-org-lease')).toBe(false);

    await waitFor(() => expect(result.current.maturity).not.toBeNull());
    expect(result.current.leaseCostDisclosure).not.toBeNull();
    expect(result.current.leaseBalancesByType).not.toBeNull();
    // Short-term leases are not in the remaining-liability map.
    expect(result.current.remainingLiabilityMap.has(leaseId(11))).toBe(false);
    expect(result.current.remainingLiabilityMap.has(leaseId(1))).toBe(true);
  });

  it('keeps activeLeases referentially stable across renders', async () => {
    const { result, rerender } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    const first = result.current.activeLeases;
    rerender();
    expect(result.current.activeLeases).toBe(first);
    await waitFor(() => expect(result.current.maturity).not.toBeNull());
    expect(result.current.activeLeases).toBe(first);
  });

  it('returns empty state without querying when there are no leases', async () => {
    const empty: Lease[] = [];
    const spy = vi.fn(fake.from);
    h.client = { ...fake, from: spy };
    const { result } = renderHook(() => useComplianceData(empty, '2026-01-01', GOLDEN_AS_OF));
    await act(async () => undefined);
    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ activeLeases: [], leaseCostDisclosure: null, leaseBalancesByType: null, maturity: null });
    expect(result.current.reassessments.size).toBe(0);
    expect(result.current.remainingLiabilityMap.size).toBe(0);
  });

  it('clears disclosures when the period no longer overlaps any active lease', async () => {
    const { result, rerender } = renderHook(({ s, e }) => useComplianceData(leases, s, e), { initialProps: { s: '2026-01-01', e: GOLDEN_AS_OF } });
    await waitFor(() => expect(result.current.maturity).not.toBeNull());
    rerender({ s: '2040-01-01', e: '2040-12-31' });
    await waitFor(() => expect(result.current.maturity).toBeNull());
    expect(result.current.activeLeases).toEqual([]);
    expect(result.current.leaseCostDisclosure).toBeNull();
    expect(result.current.remainingLiabilityMap.size).toBe(0);
  });

  it('shows an error with a working retry when the modification query fails', async () => {
    install({ failures: { select: { contract_modifications: 'denied' } } });
    const { result } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.reassessments.size).toBe(0);
    expect(result.current.activeLeases.length).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.loading).toBe(false));

    delete fake.failures.select!.contract_modifications;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.reassessments.size).toBe(1));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reads reassessments past the 1,000-row response cap', async () => {
    const mod = tables.contract_modifications[0];
    // 1,500 qualifying rows for lease 1; the latest one sits beyond the first 1,000.
    for (let i = 0; i < 1500; i += 1) {
      const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      tables.contract_modifications.push({ ...mod, id: `bulk-${String(i).padStart(4, '0')}`, lease_id: leaseId(1), modification_date: day, new_lease_term: 1000 + i });
    }
    install({ maxRows: 1000 });
    const { result } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    await waitFor(() => expect(result.current.reassessments.size).toBe(2));
    expect(result.current.reassessments.get(leaseId(1))).toMatchObject({ new_lease_term: 2499 });
    expect(result.current.reassessments.get(leaseId(6))).toMatchObject({ new_lease_term: 60 });
    expect(result.current.error).toBeNull();
  });

  it('only reads modifications of the current organization', async () => {
    const mod = tables.contract_modifications[0];
    tables.contract_modifications.push({ ...mod, id: 'mod-y', lease_id: leaseId(2), organization_id: 'org-b' });
    install();
    const { result } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    await waitFor(() => expect(result.current.reassessments.size).toBe(1));
    expect(result.current.reassessments.has(leaseId(2))).toBe(false);
  });

  it('ignores a slower earlier request when the leases change', async () => {
    const { result, rerender } = renderHook(({ ls }) => useComplianceData(ls, '2026-01-01', GOLDEN_AS_OF), { initialProps: { ls: leases } });
    const withoutLease6 = leases.filter((l) => l.id !== leaseId(6));
    rerender({ ls: withoutLease6 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current.reassessments.size).toBe(0);
  });

  it('keeps disclosures empty and reports an error when a calculation fails', async () => {
    h.maturityError = new Error('boom');
    const { result } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    await waitFor(() => expect(result.current.reassessments.size).toBe(1));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.leaseCostDisclosure).toBeNull();
    expect(result.current.maturity).toBeNull();
  });

  it('ignores results that arrive after unmount', async () => {
    const { result, unmount } = renderHook(() => useComplianceData(leases, '2026-01-01', GOLDEN_AS_OF));
    const snapshot = result.current;
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toBe(snapshot);
    expect(result.current.reassessments.size).toBe(0);
  });
});

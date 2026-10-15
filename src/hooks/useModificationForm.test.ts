import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import type { CancellationRow, ModificationRow } from '../components/modifications/types';
import { useModificationForm } from './useModificationForm';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

type Fake = ReturnType<typeof createFakeSupabase>;

const LEASES = [
  { id: 'L1', rou_asset: 30000, lease_liability: 31000, payment_timing: 'end' },
  { id: 'L2', rou_asset: null, lease_liability: null, payment_timing: 'beginning' },
] as unknown as Lease[];

let tables: Tables;
let fake: Fake;

beforeEach(() => {
  tables = {
    journal_entries: [
      { id: 'J1', lease_id: 'L1', entry_date: '2026-01-31' },
      { id: 'J2', lease_id: 'L1', entry_date: '2026-03-31' },
      { id: 'J3', lease_id: 'L2', entry_date: '2026-02-28' },
    ],
  };
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = fake as unknown as Record<string, unknown>;
});

const render = (leases: Lease[] | undefined = LEASES) => renderHook(() => useModificationForm(leases));

describe('useModificationForm – initial state', () => {
  it('starts with empty forms and closed modals', () => {
    const { result } = renderHook(() => useModificationForm());
    expect(result.current.modForm.lease_id).toBe('');
    expect(result.current.modForm.modification_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.canForm.lease_id).toBe('');
    expect(result.current.showModForm).toBe(false);
    expect(result.current.showCanForm).toBe(false);
    expect(result.current.preview).toBeNull();
    expect(result.current.canPreview).toBe(false);
    expect(result.current.canJournalEntries).toEqual([]);
    expect(result.current.canJournalLoading).toBe(false);
  });
});

describe('useModificationForm – remeasurement preview', () => {
  it('returns null without a lease, for a separate contract, or with missing payment/term', () => {
    const { result } = render();
    expect(result.current.computePreview()).toBeNull();

    act(() => result.current.setModForm((f) => ({ ...f, lease_id: 'L1', new_monthly_payment: 1000, new_lease_term: 0 })));
    expect(result.current.computePreview()).toBeNull();
    expect(result.current.canPreview).toBe(false);

    act(() => result.current.setModForm((f) => ({ ...f, new_lease_term: 12, separate_contract: true })));
    expect(result.current.computePreview()).toBeNull();
  });

  it('computes adjustments against the lease balances', () => {
    const { result } = render();
    act(() => result.current.setModForm((f) => ({ ...f, lease_id: 'L1', new_monthly_payment: 1000, new_lease_term: 12, new_discount_rate: 0.06 })));
    expect(result.current.canPreview).toBe(true);
    const p = result.current.computePreview();
    expect(p).not.toBeNull();
    expect(p!.old_rou_asset).toBe(30000);
    expect(p!.old_lease_liability).toBe(31000);
    expect(p!.new_lease_liability).toBeGreaterThan(0);
    expect(p!.liability_adjustment).toBeCloseTo(p!.new_lease_liability - 31000, 2);
    expect(p!.rou_adjustment).toBeCloseTo(p!.liability_adjustment, 2);
  });

  it('treats a lease without balances as zero and payment timing affects the PV', () => {
    const { result } = render();
    act(() => result.current.setModForm((f) => ({ ...f, lease_id: 'L2', new_monthly_payment: 1000, new_lease_term: 12, new_discount_rate: 0.06 })));
    const begin = result.current.computePreview()!;
    expect(begin.old_rou_asset).toBe(0);
    expect(begin.old_lease_liability).toBe(0);
    act(() => result.current.setModForm((f) => ({ ...f, lease_id: 'L1' })));
    const end = result.current.computePreview()!;
    // annuity-due (beginning) is worth more than ordinary annuity (end)
    expect(begin.new_lease_liability).toBeGreaterThan(end.new_lease_liability);
  });

  it('handles an unknown lease id and refreshPreview stores the result', () => {
    const { result } = render();
    act(() => result.current.setModForm((f) => ({ ...f, lease_id: 'nope', new_monthly_payment: 500, new_lease_term: 10 })));
    act(() => result.current.refreshPreview());
    expect(result.current.preview).toMatchObject({ old_rou_asset: 0, old_lease_liability: 0, new_lease_liability: 5000 });
    act(() => result.current.setPreview(null));
    expect(result.current.preview).toBeNull();
  });
});

describe('useModificationForm – edit / close', () => {
  const MOD = {
    id: 'M1',
    lease_id: 'L1',
    modification_date: '2026-05-15T00:00:00Z',
    modification_type: 'payment_change',
    reason: 'r',
    old_monthly_payment: 900,
    new_monthly_payment: 1100,
    old_lease_term: 24,
    new_lease_term: 36,
    old_discount_rate: 0.04,
    new_discount_rate: 0.05,
    accounting_treatment: 'separate',
    notes: 'hello',
    status: 'draft',
    new_classification: 'finance',
  } as unknown as ModificationRow;

  it('openEditMod populates the form and opens it; closeModForm resets', () => {
    const { result } = render();
    act(() => result.current.refreshPreview());
    act(() => result.current.openEditMod(MOD));
    expect(result.current.showModForm).toBe(true);
    expect(result.current.editingMod).toBe(MOD);
    expect(result.current.preview).toBeNull();
    expect(result.current.modForm).toMatchObject({
      id: 'M1',
      lease_id: 'L1',
      modification_date: '2026-05-15',
      new_monthly_payment: 1100,
      accounting_treatment: 'separate',
      notes: 'hello',
      new_classification: 'finance',
      separate_contract: false,
    });

    act(() => result.current.closeModForm());
    expect(result.current.showModForm).toBe(false);
    expect(result.current.editingMod).toBeNull();
    expect(result.current.modForm.lease_id).toBe('');
  });

  it('openEditMod applies defaults for missing fields', () => {
    const { result } = render();
    act(() =>
      result.current.openEditMod({
        id: 'M2',
        lease_id: 'L2',
        modification_type: 'x',
        reason: '',
        status: 'draft',
      } as unknown as ModificationRow),
    );
    expect(result.current.modForm).toMatchObject({
      old_monthly_payment: null,
      new_lease_term: 0,
      old_discount_rate: null,
      new_fair_value: null,
      new_economic_life_months: null,
      accounting_treatment: 'remeasurement',
      notes: '',
      new_classification: 'operating',
    });
    expect(result.current.modForm.modification_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('openEditMod keeps explicit zeros and the saved separate-contract inputs', () => {
    const { result } = render();
    act(() =>
      result.current.openEditMod({
        id: 'M3', lease_id: 'L2', modification_type: 'x', reason: '', status: 'pending_approval',
        old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0,
        separate_contract: true, fair_value_at_modification: 0, remaining_economic_life_months: 0,
      } as unknown as ModificationRow),
    );
    expect(result.current.modForm).toMatchObject({
      old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0,
      separate_contract: true, new_fair_value: 0, new_economic_life_months: 0,
    });
  });

  it('openEditCan populates the cancellation form; closeCanForm resets', () => {
    const { result } = render();
    const can = {
      id: 'C1',
      lease_id: 'L1',
      cancellation_date: '2026-06-30T00:00:00Z',
      cancellation_reason: 'Exit',
      early_termination: 1,
      termination_penalty: 200,
      final_payment_amount: 50,
      settlement_details: 'ok',
    } as unknown as CancellationRow;
    act(() => result.current.openEditCan(can));
    expect(result.current.showCanForm).toBe(true);
    expect(result.current.editingCan).toBe(can);
    expect(result.current.canForm).toMatchObject({
      id: 'C1',
      cancellation_date: '2026-06-30',
      early_termination: true,
      termination_penalty: 200,
      settlement_details: 'ok',
    });
    act(() => result.current.closeCanForm());
    expect(result.current.showCanForm).toBe(false);
    expect(result.current.editingCan).toBeNull();
    expect(result.current.canForm.lease_id).toBe('');
  });

  it('openEditCan applies defaults for missing fields', () => {
    const { result } = render();
    act(() => result.current.openEditCan({ id: 'C2', lease_id: 'L1', cancellation_reason: '' } as unknown as CancellationRow));
    expect(result.current.canForm).toMatchObject({
      early_termination: false,
      termination_penalty: 0,
      final_payment_amount: 0,
      settlement_details: '',
    });
    expect(result.current.canForm.cancellation_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exposes simple setters', () => {
    const { result } = render();
    act(() => {
      result.current.setShowModForm(true);
      result.current.setShowCanForm(true);
      result.current.setSelectedMod({ id: 'M1' } as ModificationRow);
      result.current.setCanForm((f) => ({ ...f, cancellation_reason: 'why' }));
    });
    expect(result.current.showModForm).toBe(true);
    expect(result.current.showCanForm).toBe(true);
    expect(result.current.selectedMod).toEqual({ id: 'M1' });
    expect(result.current.canForm.cancellation_reason).toBe('why');
  });
});

describe('useModificationForm – cancellation journal entries', () => {
  it('loads entries for the selected cancellation lease, newest first', async () => {
    const { result } = render();
    act(() => result.current.setSelectedCan({ id: 'C1', lease_id: 'L1' } as CancellationRow));
    expect(result.current.canJournalLoading).toBe(true);
    await waitFor(() => expect(result.current.canJournalLoading).toBe(false));
    expect(result.current.canJournalEntries.map((e) => e.id)).toEqual(['J2', 'J1']);

    act(() => result.current.setSelectedCan(null));
    await waitFor(() => expect(result.current.canJournalEntries).toEqual([]));
  });

  it('shows an empty list for a lease without entries', async () => {
    const { result } = render();
    act(() => result.current.setSelectedCan({ id: 'C9', lease_id: 'L9' } as CancellationRow));
    await waitFor(() => expect(result.current.canJournalLoading).toBe(false));
    expect(result.current.canJournalEntries).toEqual([]);
  });

  it('falls back to an empty list when the query fails', async () => {
    fake.failures.select = { journal_entries: 'boom' };
    const { result } = render();
    act(() => result.current.setSelectedCan({ id: 'C1', lease_id: 'L1' } as CancellationRow));
    await waitFor(() => expect(result.current.canJournalLoading).toBe(false));
    expect(result.current.canJournalEntries).toEqual([]);
  });

  it('ignores a stale response after the selection changes', async () => {
    const { result } = render();
    act(() => result.current.setSelectedCan({ id: 'C1', lease_id: 'L1' } as CancellationRow));
    act(() => result.current.setSelectedCan({ id: 'C3', lease_id: 'L2' } as CancellationRow));
    await waitFor(() => expect(result.current.canJournalLoading).toBe(false));
    expect(result.current.canJournalEntries.map((e) => e.id)).toEqual(['J3']);
  });
});

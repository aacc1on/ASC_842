import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase, RpcError, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import { useLeaseJournal } from './useLeaseJournal';

type FakeClient = ReturnType<typeof createFakeSupabase>;
type Chain = Record<string, (...args: unknown[]) => unknown>;
interface CallLog { table: string; method: string; args: unknown[] }

const h = vi.hoisted(() => ({
  client: null as unknown as Record<string, unknown>,
  showToast: null as unknown as (type: string, msg: string) => void,
  build: null as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));
vi.mock('../components/toastContextTypes', () => {
  const ctx = { showToast: (type: string, msg: string) => h.showToast(type, msg) };
  return { useToast: () => ctx };
});
vi.mock('../utils/leaseJournalBuild', () => ({
  buildLeaseJournalEntries: (...args: unknown[]) => h.build(...args),
}));

const GENERIC_REFRESH = 'Could not refresh journal entries. Please try again.';

let tables: Tables;
let fake: FakeClient;
let log: CallLog[];
const showToast = vi.fn<(type: string, msg: string) => void>();
const build = vi.fn<(lease: Lease, schedule: Row[], mods: Row[]) => Row[]>();
let refreshResult: () => unknown;
let onLog: ((c: CallLog) => void) | null = null;

function recording(base: FakeClient) {
  const from = (table: string) => {
    const target = base.from(table) as unknown as Chain;
    const proxy: Chain = new Proxy(target, {
      get(t, prop: string) {
        const fn = t[prop];
        if (prop === 'then' || typeof fn !== 'function') return typeof fn === 'function' ? fn.bind(t) : fn;
        return (...args: unknown[]) => {
          log.push({ table, method: prop, args });
          onLog?.({ table, method: prop, args });
          fn.apply(t, args);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { ...base, from };
}

/** Server stand-in: replaces the lease's journal with the payload. */
function refreshRpc(args: Record<string, unknown>, t: Tables) {
  const leaseId = args.p_lease_id as string;
  const entries = (args.p_entries as Row[]) ?? [];
  const before = t.journal_entries.length;
  t.journal_entries = t.journal_entries.filter((r) => r.lease_id !== leaseId);
  const deleted = before - t.journal_entries.length;
  entries.forEach((e, i) => t.journal_entries.push({ id: `je-new-${String(i).padStart(4, '0')}`, ...e, lease_id: leaseId }));
  return refreshResult() ?? { kept_locked: 0, deleted, inserted: entries.length, posted_through: null };
}

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  fake = createFakeSupabase(tables, {
    userId: 'user-1',
    ...opts,
    rpc: {
      get_lease_posted_through: () => null,
      refresh_lease_journal_entries: refreshRpc,
      ...opts.rpc,
    },
  });
  log = [];
  h.client = recording(fake) as unknown as Record<string, unknown>;
}

const LEASE = { id: 'lease-1', lease_name: 'HQ Office', organization_id: 'org-1' } as unknown as Lease;

function je(id: string, over: Partial<Row> = {}): Row {
  return { id, lease_id: 'lease-1', entry_date: '2026-01-31', entry_type: 'Interest', account_name: 'Interest Expense', ...over };
}

function sched(n: number, leaseId = 'lease-1'): Row {
  return { id: `${leaseId}-s${n}`, lease_id: leaseId, period_number: n, period_date: `2026-${String(n).padStart(2, '0')}-01` };
}

const toasts = (type: string) => showToast.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
const refreshCalls = () => fake.calls.filter((c) => c.fn === 'refresh_lease_journal_entries');

async function renderSettled(lease: Lease = LEASE) {
  const hook = renderHook(({ l }) => useLeaseJournal(l), { initialProps: { l: lease } });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  showToast.mockReset();
  build.mockReset();
  build.mockImplementation((lease, schedule) =>
    schedule.map((s) => ({ lease_id: lease.id, entry_date: String(s.period_date), entry_type: 'Interest', account_name: 'Interest Expense' })));
  h.showToast = showToast;
  h.build = build as unknown as (...args: unknown[]) => unknown;
  refreshResult = () => undefined;
  onLog = null;
  tables = {
    journal_entries: [],
    amortization_schedules: [sched(2), sched(1), sched(3), sched(1, 'lease-other')],
    contract_modifications: [],
    transactions: [],
  };
});

describe('useLeaseJournal — initial load', () => {
  it('starts loading and shows existing entries without regenerating', async () => {
    tables.journal_entries = [
      je('je-2', { entry_date: '2026-02-28' }),
      je('je-1', { entry_date: '2026-01-31', entry_type: 'Lease Modification' }),
      je('je-x', { lease_id: 'lease-other' }),
    ];
    setup();
    const hook = renderHook(() => useLeaseJournal(LEASE));
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.entries).toEqual([]);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-1', 'je-2']);
    expect(hook.result.current.generating).toBe(false);
    expect(build).not.toHaveBeenCalled();
    expect(refreshCalls()).toHaveLength(0);
    // has a modification entry, so no approved-mod count query
    expect(log.some((c) => c.table === 'contract_modifications')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps entries when they lack modification entries and no approved modifications exist', async () => {
    tables.journal_entries = [je('je-1')];
    tables.contract_modifications = [{ id: 'm-1', lease_id: 'lease-1', status: 'pending' }];
    setup();
    const hook = await renderSettled();
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-1']);
    expect(log).toContainEqual({ table: 'contract_modifications', method: 'select', args: ['id', { count: 'exact', head: true }] });
    expect(log).toContainEqual({ table: 'contract_modifications', method: 'eq', args: ['status', 'approved'] });
    expect(refreshCalls()).toHaveLength(0);
  });

  it('regenerates when approved modifications exist but no modification entries are stored', async () => {
    tables.journal_entries = [je('je-old')];
    tables.contract_modifications = [{ id: 'm-1', lease_id: 'lease-1', status: 'approved', modification_date: '2026-02-01' }];
    setup();
    const hook = renderHook(() => useLeaseJournal(LEASE));
    await waitFor(() => expect(refreshCalls()).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][2].map((m) => m.id)).toEqual(['m-1']);
    expect(hook.result.current.entries.map((e) => e.id)).not.toContain('je-old');
    expect(hook.result.current.entries).toHaveLength(3);
  });

  it('auto-generates when the journal is empty', async () => {
    tables.contract_modifications = [
      { id: 'm-2', lease_id: 'lease-1', status: 'approved', modification_date: '2026-03-01' },
      { id: 'm-1', lease_id: 'lease-1', status: 'approved', modification_date: '2026-02-01' },
      { id: 'm-r', lease_id: 'lease-1', status: 'rejected', modification_date: '2026-01-01' },
      { id: 'm-o', lease_id: 'lease-other', status: 'approved', modification_date: '2026-01-01' },
    ];
    setup();
    const hook = renderHook(() => useLeaseJournal(LEASE));
    await waitFor(() => expect(toasts('success')).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    const [leaseArg, scheduleArg, modsArg] = build.mock.calls[0];
    expect(leaseArg).toBe(LEASE);
    expect(scheduleArg.map((s) => s.period_number)).toEqual([1, 2, 3]);
    expect(modsArg.map((m) => m.id)).toEqual(['m-1', 'm-2']);

    expect(refreshCalls()).toHaveLength(1);
    const args = refreshCalls()[0].args as { p_lease_id: string; p_entries: Row[] };
    expect(args.p_lease_id).toBe('lease-1');
    expect(args.p_entries).toHaveLength(3);
    expect(fake.calls[0]).toEqual({ fn: 'get_lease_posted_through', args: { p_lease_id: 'lease-1' } });

    expect(toasts('success')).toEqual(['Journal entries refreshed.']);
    expect(hook.result.current.entries.map((e) => e.entry_date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(hook.result.current.generating).toBe(false);
  });

  it('shows an inline error with a working retry when the initial journal read fails', async () => {
    setup({ failures: { select: { journal_entries: 'boom' } } });
    const hook = await renderSettled();
    expect(hook.result.current.error).toBeTruthy();
    expect(hook.result.current.entries).toEqual([]);
    expect(build).not.toHaveBeenCalled();
    fake.failures.select = {};
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.entries.length).toBeGreaterThan(0));
    expect(hook.result.current.error).toBeNull();
  });

  it('pages through more than 1000 stored entries', async () => {
    tables.journal_entries = Array.from({ length: 1001 }, (_, i) =>
      je(`je-${String(i).padStart(5, '0')}`, { entry_type: i === 0 ? 'Lease Modification' : 'Interest' }));
    setup();
    const hook = await renderSettled();
    expect(hook.result.current.entries).toHaveLength(1001);
    const ranges = log.filter((c) => c.table === 'journal_entries' && c.method === 'range').map((c) => c.args);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('ignores results that arrive after unmount', async () => {
    tables.journal_entries = [];
    setup({ failures: { select: { journal_entries: 'boom', transactions: 'boom' } } });
    const hook = renderHook(() => useLeaseJournal(LEASE));
    hook.unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(showToast).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('does not generate when unmounted while the approved-modification count is in flight', async () => {
    tables.journal_entries = [je('je-1')];
    tables.contract_modifications = [{ id: 'm-1', lease_id: 'lease-1', status: 'approved' }];
    setup();
    let unmount = () => undefined as void;
    onLog = (c) => {
      if (c.table !== 'contract_modifications') return;
      onLog = null;
      unmount();
    };
    const hook = renderHook(() => useLeaseJournal(LEASE));
    unmount = hook.unmount;
    await waitFor(() => expect(log.some((c) => c.table === 'contract_modifications')).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(build).not.toHaveBeenCalled();
    expect(refreshCalls()).toHaveLength(0);
  });

  it('reloads when the lease changes', async () => {
    tables.journal_entries = [
      je('je-a', { entry_type: 'Lease Modification' }),
      je('je-b', { lease_id: 'lease-2', entry_type: 'Lease Modification' }),
    ];
    setup();
    const hook = await renderSettled();
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-a']);
    hook.rerender({ l: { ...LEASE, id: 'lease-2' } as Lease });
    await waitFor(() => expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-b']));
  });
});

describe('useLeaseJournal — posted months', () => {
  it('collects months that have posted transactions for this lease', async () => {
    tables.journal_entries = [je('je-1', { entry_type: 'Lease Modification' })];
    tables.transactions = [
      { id: 't1', lease_id: 'lease-1', transaction_date: '2026-01-15', month_end_document_id: 'd1' },
      { id: 't2', lease_id: 'lease-1', transaction_date: '2026-01-31', month_end_document_id: 'd1' },
      { id: 't3', lease_id: 'lease-1', transaction_date: '2026-02-28', month_end_document_id: 'd2' },
      { id: 't4', lease_id: 'lease-1', transaction_date: '2026-03-31', month_end_document_id: null },
      { id: 't5', lease_id: 'lease-other', transaction_date: '2026-04-30', month_end_document_id: 'd3' },
    ];
    setup();
    const hook = await renderSettled();
    await waitFor(() => expect(hook.result.current.postedMonths.size).toBe(2));
    expect([...hook.result.current.postedMonths].sort()).toEqual(['2026-01', '2026-02']);
  });

  it('warns and leaves posted months empty when posting status fails', async () => {
    tables.journal_entries = [je('je-1', { entry_type: 'Lease Modification' })];
    setup({ failures: { select: { transactions: 'boom' } } });
    const hook = await renderSettled();
    await waitFor(() => expect(toasts('error')).toEqual(['Could not load posting status. All entries are shown as projected.']));
    expect(hook.result.current.postedMonths.size).toBe(0);
    expect(hook.result.current.entries).toHaveLength(1);
  });
});

describe('useLeaseJournal — generateEntries', () => {
  async function ready() {
    tables.journal_entries = [je('je-1', { entry_type: 'Lease Modification' })];
    const hook = await renderSettled();
    showToast.mockClear();
    return hook;
  }

  it('sets generating while running and refreshes the journal via RPC', async () => {
    setup();
    const hook = await ready();
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generateEntries(); });
    expect(hook.result.current.generating).toBe(true);
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { await pending; });
    expect(hook.result.current.generating).toBe(false);
    expect(hook.result.current.loading).toBe(false);
    expect(refreshCalls()).toHaveLength(1);
    expect(toasts('success')).toEqual(['Journal entries refreshed.']);
    expect(hook.result.current.entries).toHaveLength(3);
  });

  it('reports a locked-period message when the server keeps posted entries', async () => {
    setup();
    refreshResult = () => ({ kept_locked: 2, deleted: 1, inserted: 1, posted_through: '2026-01-01' });
    const hook = await ready();
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('success')).toEqual(['Posted entries through January 2026 are locked; entries after that were refreshed.']);
  });

  it('stops before the RPC when the schedule cannot be read', async () => {
    setup();
    const hook = await ready();
    fake.failures.select = { amortization_schedules: 'boom' };
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('error')).toEqual(['Could not load the lease schedule to build journal entries.']);
    expect(refreshCalls()).toHaveLength(0);
    expect(build).not.toHaveBeenCalled();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.generating).toBe(false);
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-1']);
  });

  it('stops before the RPC when approved modifications cannot be read', async () => {
    setup();
    const hook = await ready();
    fake.failures.select = { contract_modifications: 'boom' };
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('error')).toEqual(['Could not load the lease schedule to build journal entries.']);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('shows the refresh RPC error but still reloads the stored journal', async () => {
    setup({
      rpc: {
        refresh_lease_journal_entries: () => {
          throw new RpcError('Journal entries for January 2026 are in a posted period and cannot be replaced.', 'P0001');
        },
      },
    });
    const hook = await ready();
    const readsBefore = log.filter((c) => c.table === 'journal_entries' && c.method === 'range').length;
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('error')).toEqual(['Journal entries for January 2026 are in a posted period and cannot be replaced.']);
    expect(toasts('success')).toEqual([]);
    expect(log.filter((c) => c.table === 'journal_entries' && c.method === 'range').length).toBe(readsBefore + 1);
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-1']);
    expect(hook.result.current.generating).toBe(false);
  });

  it('sanitizes an internal RPC error into the fallback message', async () => {
    setup({ rpc: { refresh_lease_journal_entries: () => { throw new RpcError('column "x" does not exist', '42703'); } } });
    const hook = await ready();
    await act(async () => { await hook.result.current.generateEntries(); });
    const [msg] = toasts('error');
    expect(msg).toBeTruthy();
    expect(msg).not.toContain('column');
  });

  it('treats a malformed RPC result as a failure', async () => {
    setup();
    refreshResult = () => ({ ok: true });
    const hook = await ready();
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('error')).toEqual([GENERIC_REFRESH]);
  });

  it('reports a failure of the posted-through lookup without calling refresh', async () => {
    setup({ rpc: { get_lease_posted_through: () => { throw new RpcError('network timeout'); } } });
    const hook = await ready();
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('error')).toEqual(['network timeout']);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('shows an error when the journal cannot be re-read after refresh', async () => {
    setup({
      rpc: {
        refresh_lease_journal_entries: (args, t) => {
          const out = refreshRpc(args, t);
          fake.failures.select = { journal_entries: 'boom' };
          return out;
        },
      },
    });
    const hook = await ready();
    await act(async () => { await hook.result.current.generateEntries(); });
    expect(toasts('success')).toEqual(['Journal entries refreshed.']);
    expect(toasts('error')).toEqual(['Could not load journal entries.']);
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(['je-1']);
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.generating).toBe(false);
  });
});

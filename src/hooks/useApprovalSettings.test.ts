import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase, RpcError, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { useApprovalSettings } from './useApprovalSettings';
import { currentOrgId } from '../utils/currentOrg';

beforeEach(() => { vi.mocked(currentOrgId).mockResolvedValue('org-1'); });

type FakeClient = ReturnType<typeof createFakeSupabase>;

const h = vi.hoisted(() => ({ client: null as unknown as Record<string | symbol, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k] }),
}));

type Chain = Record<string, (...args: unknown[]) => unknown>;
type Res = { data: unknown; error: unknown; count: number | null };

/**
 * The shared fake returns `data: null` from `update().select()`. Real PostgREST returns the updated
 * rows when the caller may see them, so this wrapper re-reads the matched rows after an update.
 */
function withUpdateReturning(base: FakeClient): FakeClient {
  const from = (table: string) => {
    const target = base.from(table) as unknown as Chain;
    let updating = false;
    let returning = false;
    let mode: 'many' | 'one' = 'many';
    const eqs: [string, unknown][] = [];
    const proxy: Chain = new Proxy(target, {
      get(t, prop: string) {
        if (prop === 'then') {
          return (ok: (v: Res) => unknown, fail: (e: unknown) => unknown) => {
            if (!(updating && returning)) return (t.then as (a: unknown, b: unknown) => unknown)(ok, fail);
            return Promise.resolve(t as unknown as PromiseLike<Res>)
              .then(async (res) => {
                if (res.error) return res;
                let q = base.from(table).select('*');
                for (const [c, v] of eqs) q = q.eq(c, v);
                const { data } = await q;
                const rows = (data ?? []) as Row[];
                return { data: mode === 'many' ? rows : rows[0] ?? null, error: null, count: null };
              })
              .then(ok, fail);
          };
        }
        const fn = t[prop];
        if (typeof fn !== 'function') return fn;
        return (...args: unknown[]) => {
          if (prop === 'update') updating = true;
          if (prop === 'select' && updating) returning = true;
          if (prop === 'eq') eqs.push([args[0] as string, args[1]]);
          if (prop === 'single' || prop === 'maybeSingle') mode = 'one';
          fn.apply(t, args);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { ...base, from } as unknown as FakeClient;
}

const pendingFromTables = (_a: Record<string, unknown>, t: Tables) => [
  ...(t.month_end_documents ?? [])
    .filter((r) => r.status === 'pending')
    .map((r) => ({ item_type: 'month_end', item_id: r.id, title: `Month-end ${r.period}`, summary: '', amount: null, prepared_by: 'u2', prepared_by_name: 'P', prepared_at: '2026-10-01' })),
  ...(t.accounting_policy_elections ?? [])
    .filter((r) => r.status === 'pending_approval')
    .map((r) => ({ item_type: 'policy_election', item_id: r.id, title: `Election ${r.id}`, summary: '', amount: null, prepared_by: 'u2', prepared_by_name: 'P', prepared_at: '2026-10-01' })),
];

function makeTables(): Tables {
  return {
    approval_settings: [
      { organization_id: 'org-1', enabled: true, require_different_approver: true, approver_role: 'admin', item_types: ['month_end'], updated_at: '2026-01-01' },
      { organization_id: 'org-2', enabled: true, require_different_approver: false, approver_role: 'manage', item_types: [], updated_at: '2026-01-01' },
    ],
    user_profiles: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }],
    month_end_documents: [{ id: 'me-1', period: '2026-09', status: 'pending' }],
    accounting_policy_elections: [{ id: 'pe-1', status: 'pending_approval' }],
  };
}

let tables: Tables;
let fake: FakeClient;

function setup(opts: Partial<FakeSupabaseOptions> = {}, returning = true) {
  fake = createFakeSupabase(tables, {
    userId: 'u1',
    ...opts,
    rpc: { get_pending_approvals: pendingFromTables, check_approval_permission: () => null, ...opts.rpc },
  });
  h.client = (returning ? withUpdateReturning(fake) : fake) as unknown as Record<string | symbol, unknown>;
}

async function renderLoaded(onPendingChange?: () => void) {
  const hook = renderHook(() => useApprovalSettings(onPendingChange));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useApprovalSettings', () => {
  beforeEach(() => {
    tables = makeTables();
  });

  it('loads settings, user count, current user and pending items', async () => {
    setup();
    const { result } = renderHook(() => useApprovalSettings());
    expect(result.current.loading).toBe(true);
    expect(result.current.settings).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.settings?.organization_id).toBe('org-1');
    expect(result.current.userCount).toBe(3);
    expect(result.current.currentUserId).toBe('u1');
    expect(result.current.pending.map((p) => p.item_id)).toEqual(['me-1', 'pe-1']);
    expect(fake.calls.map((c) => c.fn)).toEqual(['get_pending_approvals']);
  });

  it('reports a missing settings row for the organization', async () => {
    tables.approval_settings = [];
    setup();
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('Approval settings could not be found for your organization.');
    expect(result.current.settings).toBeNull();
    expect(await result.current.updateSettings({ enabled: false })).toBe(false);
    expect(await result.current.turnOffAndApprovePending()).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it.each([
    ['settings select', { select: { approval_settings: 'relation does not exist' } }],
    ['user count', { select: { user_profiles: 'timeout' } }],
  ])('surfaces a safe error when the %s fails', async (_label, failures) => {
    setup({ failures });
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('Failed to load approval settings.');
    expect(result.current.settings).toBeNull();
  });

  it('surfaces an error when pending approvals cannot be loaded', async () => {
    setup({ rpc: { get_pending_approvals: () => { throw new RpcError('Network request failed'); } } });
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('We could not reach the server. Check your internet connection and try again.');
    expect(result.current.pending).toEqual([]);
  });

  it('defaults user count to 0 and user id to null when absent', async () => {
    setup({ signedOut: true });
    const base = fake;
    h.client = {
      ...withUpdateReturning(base),
      from: (t: string) => {
        const q = withUpdateReturning(base).from(t);
        if (t !== 'user_profiles') return q;
        return { select: () => Promise.resolve({ data: [], error: null, count: null }) };
      },
    } as unknown as Record<string | symbol, unknown>;
    const { result } = await renderLoaded();
    expect(result.current.userCount).toBe(0);
    expect(result.current.currentUserId).toBeNull();
  });

  it('does not update state after unmounting mid-load', async () => {
    setup();
    const { result, unmount } = renderHook(() => useApprovalSettings());
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.loading).toBe(true);
    expect(result.current.settings).toBeNull();
  });

  it('updateSettings writes only to the current organization and stores the returned row', async () => {
    setup();
    const { result } = await renderLoaded();
    let ok = false;
    await act(async () => { ok = await result.current.updateSettings({ approver_role: 'manage', item_types: ['impairment'] }); });
    expect(ok).toBe(true);
    expect(result.current.notice).toBe('Approval settings saved.');
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(result.current.settings).toMatchObject({ organization_id: 'org-1', approver_role: 'manage', item_types: ['impairment'] });
    expect(fake.writes).toEqual([
      { op: 'update', table: 'approval_settings', values: { approver_role: 'manage', item_types: ['impairment'] }, matched: 1 },
    ]);
    expect(tables.approval_settings[1].approver_role).toBe('manage');
    expect(tables.approval_settings[1].organization_id).toBe('org-2');
    expect(tables.approval_settings[1].item_types).toEqual([]);

    act(() => result.current.clearMessages());
    expect(result.current.notice).toBeNull();
  });

  it('updateSettings explains when the update returns no row (non-admin)', async () => {
    setup({}, false);
    const { result } = await renderLoaded();
    let ok = true;
    await act(async () => { ok = await result.current.updateSettings({ enabled: false }); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Only administrators can change approval settings.');
    expect(result.current.settings?.enabled).toBe(true);
  });

  it('updateSettings maps a database error to a safe message', async () => {
    setup();
    const { result } = await renderLoaded();
    fake.failures.write = { approval_settings: 'new row violates row-level security policy' };
    let ok = true;
    await act(async () => { ok = await result.current.updateSettings({ enabled: false }); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to save approval settings.');
    act(() => result.current.clearMessages());
    expect(result.current.error).toBeNull();
  });

  it('turnOffAndApprovePending disables the workflow and approves every pending item', async () => {
    setup();
    const onPendingChange = vi.fn();
    const { result } = await renderLoaded(onPendingChange);
    let ok = false;
    await act(async () => { ok = await result.current.turnOffAndApprovePending(); });
    expect(ok).toBe(true);
    expect(result.current.notice).toBe('Approval workflow turned off. 2 pending item(s) were approved automatically.');
    expect(tables.approval_settings[0].enabled).toBe(false);
    expect(tables.month_end_documents[0].status).toBe('posted');
    expect(tables.accounting_policy_elections[0].status).toBe('approved');
    expect(result.current.pending).toEqual([]);
    expect(onPendingChange).toHaveBeenCalledTimes(1);
    expect(fake.calls.filter((c) => c.fn === 'check_approval_permission').map((c) => c.args)).toEqual([
      { p_item_type: 'month_end', p_item_id: 'me-1' },
      { p_item_type: 'policy_election', p_item_id: 'pe-1' },
    ]);
    expect(result.current.saving).toBe(false);
  });

  it('turnOffAndApprovePending with nothing pending just turns the workflow off', async () => {
    tables.month_end_documents = [];
    tables.accounting_policy_elections = [];
    setup();
    const { result } = await renderLoaded();
    await act(async () => { await result.current.turnOffAndApprovePending(); });
    expect(result.current.notice).toBe('Approval workflow turned off.');
  });

  it('turnOffAndApprovePending falls back to loaded pending items and reports per-item failures', async () => {
    let pendingCalls = 0;
    setup({
      rpc: {
        get_pending_approvals: (a, t) => {
          pendingCalls += 1;
          if (pendingCalls > 1) throw new RpcError('timed out');
          return pendingFromTables(a, t);
        },
        check_approval_permission: (a) => (a.p_item_type === 'month_end' ? 'Segregation of duties: you prepared this item.' : null),
      },
    });
    const { result } = await renderLoaded();
    let ok = true;
    await act(async () => { ok = await result.current.turnOffAndApprovePending(); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe(
      'Approval workflow turned off, but 1 item(s) could not be approved automatically. Month-end 2026-09: Segregation of duties: you prepared this item.',
    );
    expect(tables.month_end_documents[0].status).toBe('pending');
    expect(tables.accounting_policy_elections[0].status).toBe('approved');
    expect(tables.approval_settings[0].enabled).toBe(false);
  });

  it('turnOffAndApprovePending stops when the settings update fails', async () => {
    setup({}, false);
    const { result } = await renderLoaded();
    let ok = true;
    await act(async () => { ok = await result.current.turnOffAndApprovePending(); });
    expect(ok).toBe(false);
    expect(fake.calls.some((c) => c.fn === 'check_approval_permission')).toBe(false);
    expect(tables.month_end_documents[0].status).toBe('pending');
  });

  it('approve posts the item, reloads pending and notifies', async () => {
    setup();
    const onPendingChange = vi.fn();
    const { result } = await renderLoaded(onPendingChange);
    let ok = false;
    await act(async () => { ok = await result.current.approve('month_end', 'me-1'); });
    expect(ok).toBe(true);
    expect(result.current.notice).toBe('Item approved and now effective.');
    expect(result.current.pending.map((p) => p.item_id)).toEqual(['pe-1']);
    expect(fake.writes).toEqual([{ op: 'update', table: 'month_end_documents', values: { status: 'posted' }, matched: 1 }]);
    expect(onPendingChange).toHaveBeenCalledTimes(1);
  });

  it('approve shows a safe fallback for internal errors', async () => {
    setup({ rpc: { check_approval_permission: () => { throw new RpcError('function check_approval_permission does not exist', '42883'); } } });
    const { result } = await renderLoaded();
    let ok = true;
    await act(async () => { ok = await result.current.approve('policy_election', 'pe-1'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to approve item.');
    expect(result.current.saving).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it('reject returns the item to draft with a trimmed comment', async () => {
    setup();
    const { result } = await renderLoaded();
    await act(async () => { await result.current.reject('policy_election', 'pe-1', '  wrong rate  '); });
    expect(result.current.notice).toBe('Item returned to the preparer as a draft.');
    expect(fake.writes).toEqual([
      { op: 'update', table: 'accounting_policy_elections', values: { status: 'draft', rejection_comment: 'wrong rate' }, matched: 1 },
    ]);
    expect(result.current.pending.map((p) => p.item_id)).toEqual(['me-1']);
  });

  it('reject requires a comment', async () => {
    setup();
    const { result } = await renderLoaded();
    let ok = true;
    await act(async () => { ok = await result.current.reject('month_end', 'me-1', '   '); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('A comment is required to reject an item.');
    expect(fake.writes).toEqual([]);
  });
});

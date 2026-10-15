import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { toUserMessage } from '../utils/errors';
import { useAuditLog, resolveRecordLabel, AUDIT_TABLES, type AuditLogFilters } from './useAuditLog';
import { currentOrgId } from '../utils/currentOrg';

beforeEach(() => { vi.mocked(currentOrgId).mockResolvedValue('org-1'); });

type FakeClient = ReturnType<typeof createFakeSupabase>;
type Chain = Record<string, (...args: unknown[]) => unknown>;
interface CallLog { table: string; method: string; args: unknown[] }

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const NO_FILTERS: AuditLogFilters = { dateFrom: '', dateTo: '', tableName: '', actorUserId: '' };

let tables: Tables;
let fake: FakeClient;
let log: CallLog[];
/** Tables whose `from()` call throws synchronously. */
let throwOn: Set<string>;

/** Wraps the fake so chained builder calls are logged and selected tables can throw. */
function recording(base: FakeClient) {
  const from = (table: string) => {
    if (throwOn.has(table)) throw new Error(`boom on ${table}`);
    const target = base.from(table) as unknown as Chain;
    const proxy: Chain = new Proxy(target, {
      get(t, prop: string) {
        const fn = t[prop];
        if (prop === 'then' || typeof fn !== 'function') return typeof fn === 'function' ? fn.bind(t) : fn;
        return (...args: unknown[]) => {
          log.push({ table, method: prop, args });
          fn.apply(t, args);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { ...base, from };
}

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  fake = createFakeSupabase(tables, { userId: 'user-1', ...opts });
  log = [];
  h.client = recording(fake) as unknown as Record<string, unknown>;
}

let seq = 0;
function audit(over: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: seq,
    organization_id: 'org-1',
    actor_user_id: 'u-alice',
    table_name: 'leases',
    record_id: 'lease-1',
    action: 'UPDATE',
    old_data: null,
    new_data: null,
    changed_fields: null,
    created_at: `2026-01-${String(10 + (seq % 10)).padStart(2, '0')}T12:00:00Z`,
    ...over,
  };
}

async function renderLoaded() {
  const hook = renderHook(() => useAuditLog());
  await waitFor(() => expect(log.some((c) => c.table === 'user_profiles')).toBe(true));
  await act(async () => { await Promise.resolve(); });
  return hook;
}

async function load(hook: Awaited<ReturnType<typeof renderLoaded>>, filters: Partial<AuditLogFilters> = {}) {
  await act(async () => { await hook.result.current.loadAuditLogs({ ...NO_FILTERS, ...filters }); });
}

beforeEach(() => {
  seq = 0;
  throwOn = new Set();
  tables = {
    audit_log: [],
    user_profiles: [
      { user_id: 'u-bob', email: 'bob@acme.test' },
      { user_id: 'u-alice', email: 'alice@acme.test' },
    ],
    leases: [{ id: 'lease-1', lease_name: 'HQ Office' }],
  };
});

describe('useAuditLog — users', () => {
  it('loads users on mount, ordered by email', async () => {
    setup();
    const hook = renderHook(() => useAuditLog());
    expect(hook.result.current.users).toEqual([]);
    expect(hook.result.current.loading).toBe(false);
    await waitFor(() => expect(hook.result.current.users).toHaveLength(2));
    expect(hook.result.current.users.map((u) => u.email)).toEqual(['alice@acme.test', 'bob@acme.test']);
    expect(log).toContainEqual({ table: 'user_profiles', method: 'select', args: ['user_id, email'] });
  });

  it('keeps users empty when the user query errors', async () => {
    setup({ failures: { select: { user_profiles: 'denied' } } });
    const hook = await renderLoaded();
    expect(hook.result.current.users).toEqual([]);
    expect(hook.result.current.error).toBe('');
  });

  it('swallows exceptions thrown while loading users', async () => {
    setup();
    throwOn.add('user_profiles');
    const hook = renderHook(() => useAuditLog());
    await act(async () => { await hook.result.current.loadUsers(); });
    expect(hook.result.current.users).toEqual([]);
    expect(hook.result.current.error).toBe('');
  });

  it('loadUsers can be re-invoked to pick up new users', async () => {
    setup();
    const hook = await renderLoaded();
    tables.user_profiles.push({ user_id: 'u-carol', email: 'carol@acme.test' });
    await act(async () => { await hook.result.current.loadUsers(); });
    expect(hook.result.current.users.map((u) => u.user_id)).toEqual(['u-alice', 'u-bob', 'u-carol']);
  });
});

describe('useAuditLog — loadAuditLogs', () => {
  it('toggles loading and returns rows newest first with resolved labels', async () => {
    tables.audit_log = [
      audit({ id: 1, created_at: '2026-01-01T09:00:00Z' }),
      audit({ id: 2, created_at: '2026-01-03T09:00:00Z' }),
      audit({ id: 3, created_at: '2026-01-02T09:00:00Z' }),
    ];
    setup();
    const hook = await renderLoaded();

    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.loadAuditLogs(NO_FILTERS); });
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { await pending; });

    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toBe('');
    expect(hook.result.current.rows.map((r) => r.id)).toEqual([2, 3, 1]);
    expect(hook.result.current.rows.every((r) => r.record_label === 'HQ Office')).toBe(true);
    expect(hook.result.current.recordLabels.get('leases:lease-1')).toBe('HQ Office');
  });

  it('handles an empty audit log', async () => {
    setup();
    const hook = await renderLoaded();
    await load(hook);
    expect(hook.result.current.rows).toEqual([]);
    expect(hook.result.current.recordLabels.size).toBe(0);
    expect(hook.result.current.error).toBe('');
    // no label lookups when there is nothing to resolve
    expect(log.filter((c) => c.method === 'in')).toHaveLength(0);
  });

  it('caps the result at 200 rows', async () => {
    tables.audit_log = Array.from({ length: 205 }, (_, i) =>
      audit({ id: i + 1, created_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    setup();
    const hook = await renderLoaded();
    await load(hook);
    expect(hook.result.current.rows).toHaveLength(200);
    expect(hook.result.current.rows[0].id).toBe(205);
    expect(log).toContainEqual({ table: 'audit_log', method: 'limit', args: [200] });
  });

  it('applies table, actor and inclusive date-range filters', async () => {
    tables.audit_log = [
      audit({ id: 1, created_at: '2026-01-05T00:00:00Z' }),
      audit({ id: 2, created_at: '2026-01-07T23:59:58Z' }),
      audit({ id: 3, created_at: '2026-01-04T23:59:59Z' }),
      audit({ id: 4, created_at: '2026-01-08T00:00:01Z' }),
      audit({ id: 5, created_at: '2026-01-06T00:00:00Z', actor_user_id: 'u-bob' }),
      audit({ id: 6, created_at: '2026-01-06T00:00:00Z', table_name: 'branches', record_id: 'b-1' }),
    ];
    setup();
    const hook = await renderLoaded();
    await load(hook, { tableName: 'leases', actorUserId: 'u-alice', dateFrom: '2026-01-05', dateTo: '2026-01-07' });

    expect(hook.result.current.rows.map((r) => r.id)).toEqual([2, 1]);
    const auditCalls = log.filter((c) => c.table === 'audit_log');
    expect(auditCalls).toContainEqual({ table: 'audit_log', method: 'eq', args: ['table_name', 'leases'] });
    expect(auditCalls).toContainEqual({ table: 'audit_log', method: 'eq', args: ['actor_user_id', 'u-alice'] });
    expect(auditCalls).toContainEqual({ table: 'audit_log', method: 'gte', args: ['created_at', '2026-01-05T00:00:00'] });
    expect(auditCalls).toContainEqual({ table: 'audit_log', method: 'lte', args: ['created_at', '2026-01-07T23:59:59'] });
  });

  it('omits filters that are empty', async () => {
    setup();
    const hook = await renderLoaded();
    await load(hook);
    const auditCalls = log.filter((c) => c.table === 'audit_log');
    const methods = auditCalls.map((c) => c.method);
    expect(auditCalls.filter((c) => c.method === 'eq')).toEqual([{ table: 'audit_log', method: 'eq', args: ['organization_id', 'org-1'] }]);
    expect(methods).not.toContain('gte');
    expect(methods).not.toContain('lte');
  });

  it('surfaces a sanitized error when the audit query fails and keeps previous rows', async () => {
    tables.audit_log = [audit({ id: 1 })];
    setup();
    const hook = await renderLoaded();
    await load(hook);
    expect(hook.result.current.rows).toHaveLength(1);

    fake.failures.select = { audit_log: 'syntax error at or near "relation"' };
    await load(hook);
    expect(hook.result.current.error).toBe(toUserMessage({ message: 'syntax error at or near "relation"' }));
    expect(hook.result.current.error).not.toContain('relation');
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.rows).toHaveLength(1);
  });

  it('clears a previous error on the next successful load', async () => {
    setup({ failures: { select: { audit_log: 'nope' } } });
    const hook = await renderLoaded();
    await load(hook);
    expect(hook.result.current.error).not.toBe('');
    fake.failures.select = {};
    await load(hook);
    expect(hook.result.current.error).toBe('');
  });

  it('reports a fallback message when the query throws', async () => {
    setup();
    const hook = await renderLoaded();
    throwOn.add('audit_log');
    await load(hook);
    expect(hook.result.current.error).toBe(toUserMessage(new Error('boom on audit_log'), 'Failed to load audit logs'));
    expect(hook.result.current.error).not.toContain('boom');
    expect(hook.result.current.loading).toBe(false);
  });
});

describe('useAuditLog — record name resolution', () => {
  it('resolves labels per table, mapping aliased tables to their backing table', async () => {
    tables.lease_transactions = [{ id: 't-1', transaction_type: 'Payment' }];
    tables.contract_modifications = [
      { id: 'm-1', reason: 'Term extension' },
      { id: 'c-1', reason: 'Early exit' },
    ];
    tables.month_end_documents = [{ id: 'p-1', period_label: 'Jan 2026' }];
    tables.branches = [{ id: 'b-1', branch_name: 'North' }];
    tables.companies = [{ id: 'co-1', company_name: 'Acme' }];
    tables.lease_impairments = [{ id: 'i-1', reason: 'Vacated' }];
    tables.user_profiles.push({ id: 'up-1', user_id: 'u-x', email: 'x@acme.test' });
    tables.audit_log = [
      audit({ table_name: 'transactions', record_id: 't-1' }),
      audit({ table_name: 'lease_transactions', record_id: 't-1' }),
      audit({ table_name: 'lease_modifications', record_id: 'm-1' }),
      audit({ table_name: 'contract_cancellations', record_id: 'c-1' }),
      audit({ table_name: 'accounting_periods', record_id: 'p-1' }),
      audit({ table_name: 'month_end_documents', record_id: 'p-1' }),
      audit({ table_name: 'branches', record_id: 'b-1' }),
      audit({ table_name: 'companies', record_id: 'co-1' }),
      audit({ table_name: 'lease_impairments', record_id: 'i-1' }),
      audit({ table_name: 'user_profiles', record_id: 'up-1' }),
    ];
    setup();
    const hook = await renderLoaded();
    await load(hook);

    const byTable = Object.fromEntries(hook.result.current.rows.map((r) => [r.table_name, r.record_label]));
    expect(byTable).toEqual({
      transactions: 'Payment',
      lease_transactions: 'Payment',
      lease_modifications: 'Term extension',
      contract_cancellations: 'Early exit',
      accounting_periods: 'Jan 2026',
      month_end_documents: 'Jan 2026',
      branches: 'North',
      companies: 'Acme',
      lease_impairments: 'Vacated',
      user_profiles: 'x@acme.test',
    });
    const lookups = log.filter((c) => c.method === 'select' && c.table !== 'audit_log' && String(c.args[0]).startsWith('id, '));
    expect(lookups).toContainEqual({ table: 'lease_transactions', method: 'select', args: ['id, transaction_type'] });
    expect(lookups).toContainEqual({ table: 'month_end_documents', method: 'select', args: ['id, period_label'] });
    expect(lookups.some((c) => c.table === 'transactions' || c.table === 'accounting_periods')).toBe(false);
  });

  it('batches ids per table into a single IN lookup', async () => {
    tables.leases.push({ id: 'lease-2', lease_name: 'Warehouse' });
    tables.audit_log = [
      audit({ record_id: 'lease-1' }),
      audit({ record_id: 'lease-2' }),
      audit({ record_id: 'lease-1' }),
    ];
    setup();
    const hook = await renderLoaded();
    await load(hook);
    const ins = log.filter((c) => c.table === 'leases' && c.method === 'in');
    expect(ins).toHaveLength(1);
    expect(ins[0].args).toEqual(['id', ['lease-1', 'lease-2']]);
    expect(hook.result.current.rows.map((r) => r.record_label).sort()).toEqual(['HQ Office', 'HQ Office', 'Warehouse']);
  });

  it('labels missing records as deleted and unknown tables by id prefix', async () => {
    tables.leases.push({ id: 'lease-blank', lease_name: '' });
    tables.audit_log = [
      audit({ table_name: 'leases', record_id: 'lease-gone' }),
      audit({ table_name: 'leases', record_id: 'lease-blank' }),
      audit({ table_name: 'mystery_table', record_id: 'abcdef1234567890' }),
    ];
    setup();
    const hook = await renderLoaded();
    await load(hook);
    const labels = Object.fromEntries(hook.result.current.rows.map((r) => [r.record_id, r.record_label]));
    expect(labels).toEqual({
      'lease-gone': '(deleted lease)',
      'lease-blank': '(deleted lease)',
      abcdef1234567890: 'abcdef12',
    });
    expect(log.some((c) => c.table === 'mystery_table')).toBe(false);
  });

  it('falls back to deleted labels when a lookup query errors', async () => {
    tables.audit_log = [audit({ record_id: 'lease-1' })];
    setup({ failures: { select: { leases: 'denied' } } });
    const hook = await renderLoaded();
    await load(hook);
    expect(hook.result.current.error).toBe('');
    expect(hook.result.current.rows[0].record_label).toBe('(deleted lease)');
  });

  it('isolates a throwing lookup so other tables still resolve', async () => {
    tables.branches = [{ id: 'b-1', branch_name: 'North' }];
    tables.audit_log = [
      audit({ table_name: 'leases', record_id: 'lease-1' }),
      audit({ table_name: 'branches', record_id: 'b-1' }),
    ];
    setup();
    throwOn.add('leases');
    const hook = await renderLoaded();
    await load(hook);
    const labels = Object.fromEntries(hook.result.current.rows.map((r) => [r.table_name, r.record_label]));
    expect(labels).toEqual({ leases: '(deleted lease)', branches: 'North' });
    expect(hook.result.current.error).toBe('');
  });
});

describe('resolveRecordLabel', () => {
  it('prefers a resolved label, then deleted label, then id prefix', () => {
    const m = new Map([['companies:co-1', 'Acme']]);
    expect(resolveRecordLabel('companies', 'co-1', m)).toBe('Acme');
    expect(resolveRecordLabel('companies', 'co-2', m)).toBe('(deleted company)');
    expect(resolveRecordLabel('accounting_periods', 'x', m)).toBe('(deleted accounting period)');
    expect(resolveRecordLabel('other', '0123456789', m)).toBe('01234567');
  });

  it('has a deleted-label for every audited table', () => {
    for (const t of AUDIT_TABLES) {
      expect(resolveRecordLabel(t, 'zzzzzzzzzzzz', new Map())).toMatch(/^\(deleted .+\)$/);
    }
  });
});

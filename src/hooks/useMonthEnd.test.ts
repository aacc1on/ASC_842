import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Lease } from '../types/lease';
import type { Transaction } from '../components/transactions/types';
import { reportCriticalError } from '../utils/errorReporter';
import { currentOrgId } from '../utils/currentOrg';
import { UserFacingError } from '../utils/errors';
import { useMonthEnd } from './useMonthEnd';

type FakeClient = ReturnType<typeof createFakeSupabase>;
type Chain = Record<string, (...args: unknown[]) => unknown>;
interface CallLog { table: string; method: string; args: unknown[] }

const h = vi.hoisted(() => ({ client: null as unknown as Record<string | symbol, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k] }),
}));
vi.mock('../utils/errorReporter', () => ({ reportCriticalError: vi.fn() }));

/** Wraps the fake so every chained builder call is logged; optionally replaces a table's insert result. */
function recording(base: FakeClient, log: CallLog[], insertResult?: Record<string, { data: unknown; error: unknown }>) {
  const from = (table: string) => {
    const target = base.from(table) as unknown as Chain;
    const proxy: Chain = new Proxy(target, {
      get(t, prop: string) {
        const fn = t[prop];
        if (prop === 'then' || typeof fn !== 'function') return typeof fn === 'function' ? fn.bind(t) : fn;
        return (...args: unknown[]) => {
          log.push({ table, method: prop, args });
          if (prop === 'insert' && insertResult?.[table]) {
            const res = insertResult[table];
            const done = { select: () => done, single: () => Promise.resolve(res) };
            return done;
          }
          fn.apply(t, args);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { ...base, from };
}

let seq = 0;
function lease(over: Partial<Lease> = {}): Lease {
  seq += 1;
  return {
    id: `lease-${String(seq).padStart(4, '0')}`,
    organization_id: 'org-1',
    lease_name: `Lease ${seq}`,
    status: 'active',
    lease_start_date: '2026-09-01',
    lease_term_months: 12,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    payment_timing: 'beginning',
    lease_classification: 'finance',
    accounting_treatment: 'recognized',
    component_policy: 'not_applicable',
    ...over,
  } as Lease;
}

function ym(index: number) {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { period: `${y}-${String(m).padStart(2, '0')}`, date: `${y}-${String(m).padStart(2, '0')}-28` };
}

/** Schedule rows for a lease starting at its lease_start_date, one per month. */
function schedule(l: Lease, count: number, amounts = (n: number) => ({ interest: 10 + n, payment: 1000, dep: 80 })): Row[] {
  const [y, m] = l.lease_start_date.split('-').map(Number);
  const start = y * 12 + (m - 1);
  return Array.from({ length: count }, (_, i) => {
    const a = amounts(i + 1);
    return {
      id: `${l.id}-s${String(i + 1).padStart(5, '0')}`,
      lease_id: l.id,
      period_number: i + 1,
      period_date: ym(start + i).date,
      beginning_liability: 0,
      payment_amount: a.payment,
      interest_expense: a.interest,
      principal_reduction: 0,
      ending_liability: 0,
      rou_asset_balance: 0,
      depreciation_expense: a.dep,
    };
  });
}

let tables: Tables;
let fake: FakeClient;
let log: CallLog[];
const refreshData = vi.fn();
const setSuccessMessage = vi.fn();
const setErrorMessage = vi.fn();
const confirm = vi.fn(async () => true);

function setup(opts: Partial<FakeSupabaseOptions> = {}, insertResult?: Record<string, { data: unknown; error: unknown }>) {
  fake = createFakeSupabase(tables, { userId: 'user-1', ...opts });
  log = [];
  h.client = recording(fake, log, insertResult) as unknown as Record<string | symbol, unknown>;
}

function renderMonthEnd(leases: Lease[], transactions: Transaction[] = []) {
  return renderHook(() =>
    useMonthEnd({ leases, transactions, refreshData, setSuccessMessage, setErrorMessage, confirmDialog: { confirm } }),
  );
}

async function preview(leases: Lease[], period = '2026-09', transactions: Transaction[] = []) {
  const hook = renderMonthEnd(leases, transactions);
  act(() => hook.result.current.setMonthEndPeriod(period));
  await act(async () => { await hook.result.current.handleGenerateMonthEndPreview(); });
  return hook;
}

const lastError = () => setErrorMessage.mock.lastCall?.[0];
const callsFor = (table: string, method: string) => log.filter((c) => c.table === table && c.method === method).map((c) => c.args);

describe('useMonthEnd', () => {
  beforeEach(() => {
    vi.mocked(currentOrgId).mockResolvedValue('org-1');
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    tables = { month_end_documents: [], transactions: [], month_end_catch_up_lines: [], amortization_schedules: [], lease_payment_schedules: [] };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('modal and validation', () => {
    it('opens the modal reset to the current month', () => {
      setup();
      const { result } = renderMonthEnd([]);
      expect(result.current.monthEndPeriod).toBe('2026-10');
      act(() => {
        result.current.setMonthEndPeriod('2026-01');
        result.current.setMonthEndPreview([{ lease_id: 'x' } as never]);
      });
      act(() => result.current.handleOpenMonthEndModal());
      expect(result.current.showMonthEndModal).toBe(true);
      expect(result.current.monthEndPeriod).toBe('2026-10');
      expect(result.current.monthEndPreview).toEqual([]);
      expect(result.current.skippedLeases).toEqual([]);
      expect(setErrorMessage).toHaveBeenCalledWith('');
      act(() => result.current.setShowMonthEndModal(false));
      expect(result.current.showMonthEndModal).toBe(false);
    });

    it.each([
      ['2026-13', 'Month must be between 01 and 12'],
      ['26-09', 'Period must be in YYYY-MM format'],
      ['1999-12', 'Year must be between 2000 and 2100'],
    ])('rejects invalid period %s without querying', async (period, msg) => {
      setup();
      const { result } = await preview([lease()], period);
      expect(lastError()).toBe(msg);
      expect(log).toEqual([]);
      expect(result.current.submitting).toBe(false);
    });

    it('refuses a period that has not ended yet (current month)', async () => {
      setup();
      await preview([lease()], '2026-10');
      expect(lastError()).toBe('October 2026 has not ended yet. Month-end can be processed only after the last day of the month.');
      expect(log).toEqual([]);
    });

    it('refuses a period that already has posted month-end transactions', async () => {
      setup();
      const txs = [
        { id: 't1', period: '2026-09', month_end_document_id: null },
        { id: 't2', period: '2026-09', month_end_document_id: 'doc-1' },
      ] as unknown as Transaction[];
      await preview([lease()], '2026-09', txs);
      expect(lastError()).toBe('Month-end has already been processed for 2026-09.');
      expect(log).toEqual([]);
    });

    it('refuses a period with a month-end document awaiting approval', async () => {
      tables.month_end_documents = [
        { id: 'd0', period: '2026-08', status: 'pending' },
        { id: 'd1', period: '2026-09', status: 'pending' },
      ];
      setup();
      await preview([lease()]);
      expect(lastError()).toBe('Month-end for 2026-09 is already awaiting approval in Settings > Approval.');
      expect(callsFor('month_end_documents', 'eq')).toEqual([['organization_id', 'org-1'], ['period', '2026-09'], ['status', 'pending']]);
      expect(callsFor('amortization_schedules', 'select')).toEqual([]);
    });

    it('ignores non-pending documents for the period', async () => {
      tables.month_end_documents = [{ id: 'd1', period: '2026-09', status: 'draft' }];
      const l = lease();
      tables.amortization_schedules = schedule(l, 12);
      setup();
      const { result } = await preview([l]);
      expect(result.current.monthEndPreview).toHaveLength(3);
    });

    it('reports a safe message when the pending-document check fails', async () => {
      setup({ failures: { select: { month_end_documents: 'permission denied for table month_end_documents' } } });
      const { result } = await preview([lease()]);
      expect(lastError()).toBe('Could not check existing month-end documents.');
      expect(result.current.monthEndPreview).toEqual([]);
    });
  });

  describe('preview generation', () => {
    it('builds finance-lease entries from stored schedules scoped to the given leases', async () => {
      const l = lease({ lease_name: 'HQ', lease_start_date: '2026-09-01' });
      const foreign = lease({ organization_id: 'org-2' });
      tables.amortization_schedules = [...schedule(l, 12), ...schedule(foreign, 12, () => ({ interest: 999, payment: 999, dep: 999 }))];
      setup();
      const { result } = await preview([l]);

      expect(result.current.monthEndPreview.map((r) => [r.transaction_type, r.debit_amount])).toEqual([
        ['interest', 11],
        ['payment', 1000],
        ['amortization', 80],
      ]);
      expect(result.current.monthEndPreview.every((r) => r.lease_id === l.id && r.period === '2026-09')).toBe(true);
      expect(result.current.skippedLeases).toEqual([]);
      expect(setErrorMessage.mock.calls.every(([m]) => m === '')).toBe(true);
      expect(callsFor('amortization_schedules', 'in')).toEqual([['lease_id', [l.id]]]);
      expect(callsFor('transactions', 'in')).toEqual([['lease_id', [l.id]]]);
      expect(callsFor('transactions', 'not')).toEqual([['month_end_document_id', 'is', null]]);
      expect(callsFor('transactions', 'lt')).toEqual([['period', '2026-09']]);
      expect(callsFor('month_end_catch_up_lines', 'lt')).toEqual([['missed_period', '2026-09']]);
      expect(callsFor('lease_payment_schedules', 'select')).toEqual([]);
      expect(result.current.submitting).toBe(false);
    });

    it('pages schedules and catch-up lines beyond 1,000 rows', async () => {
      // Lease started 1049 months before 2026-09, so the target row is period 1050 (on the second page).
      const target = 2026 * 12 + 8;
      const startIdx = target - 1049;
      const l = lease({ lease_name: 'Long', lease_start_date: `${ym(startIdx).period}-01`, lease_term_months: 1100 });
      tables.amortization_schedules = schedule(l, 1100, (n) => ({ interest: n, payment: 0, dep: 5 }));
      tables.month_end_catch_up_lines = Array.from({ length: 1049 }, (_, i) => ({
        id: `cu-${String(i).padStart(5, '0')}`,
        lease_id: l.id,
        missed_period: ym(startIdx + i).period,
      }));
      setup();
      const { result } = await preview([l]);

      expect(setErrorMessage.mock.calls.every(([m]) => m === '')).toBe(true);
      expect(result.current.monthEndPreview.map((r) => [r.transaction_type, r.debit_amount])).toEqual([
        ['interest', 1050],
        ['amortization', 5],
      ]);
      expect(callsFor('amortization_schedules', 'range')).toEqual([[0, 999], [1000, 1999]]);
      expect(callsFor('month_end_catch_up_lines', 'range')).toEqual([[0, 999], [1000, 1999]]);
      expect(callsFor('transactions', 'range')).toEqual([[0, 999]]);
    });

    it('blocks when an earlier month was never processed, naming up to three leases', async () => {
      const ls = [1, 2, 3, 4, 5].map((i) => lease({ lease_name: `L${i}`, lease_start_date: '2026-07-01' }));
      tables.amortization_schedules = ls.flatMap((l) => schedule(l, 12));
      // July is fully processed (posted for L1-L3, catch-up for L4-L5); August only for L1.
      tables.transactions = [
        ...ls.slice(0, 3).map((l, i) => ({ id: `p${i}`, lease_id: l.id, period: '2026-07', month_end_document_id: 'd7' })),
        { id: 'p9', lease_id: ls[0].id, period: '2026-08', month_end_document_id: 'd8' },
        { id: 'px', lease_id: ls[1].id, period: '2026-08', month_end_document_id: null },
      ];
      tables.month_end_catch_up_lines = ls.slice(3).map((l, i) => ({ id: `c${i}`, lease_id: l.id, missed_period: '2026-07' }));
      setup();
      const { result } = await preview(ls);
      expect(lastError()).toBe(
        'August 2026 has not been processed yet (L2, L3, L4, +1 more). Process month-end for earlier months in order before September 2026.',
      );
      expect(result.current.monthEndPreview).toEqual([]);
    });

    it('reports the earliest unprocessed month across leases', async () => {
      const a = lease({ lease_name: 'A', lease_start_date: '2026-08-01' });
      const b = lease({ lease_name: 'B', lease_start_date: '2026-06-01' });
      tables.amortization_schedules = [...schedule(a, 12), ...schedule(b, 12)];
      tables.transactions = [{ id: 'p', lease_id: b.id, period: '2026-06', month_end_document_id: 'd' }];
      setup();
      await preview([a, b]);
      expect(lastError()).toBe(
        'July 2026 has not been processed yet (B). Process month-end for earlier months in order before September 2026.',
      );
    });

    it('loads payment tranches for short-term leases and skips schedule lookups when none are recognized', async () => {
      const st = lease({ accounting_treatment: 'short_term_exemption', lease_term_months: 12, payment_amount: 999, lease_name: 'Short' });
      const stNoTranches = lease({ accounting_treatment: 'short_term_exemption', lease_term_months: 12, payment_amount: 600, lease_name: 'Short2' });
      tables.lease_payment_schedules = [
        { id: 'ps2', lease_id: st.id, from_month: 7, to_month: 12, payment_amount: 2000 },
        { id: 'ps1', lease_id: st.id, from_month: 1, to_month: 6, payment_amount: 1000 },
        { id: 'ps3', lease_id: 'other-lease', from_month: 1, to_month: 12, payment_amount: 5 },
      ];
      setup();
      const { result } = await preview([st, stNoTranches]);

      expect(callsFor('lease_payment_schedules', 'in')).toEqual([['lease_id', [st.id, stNoTranches.id]]]);
      expect(callsFor('amortization_schedules', 'select')).toEqual([]);
      expect(callsFor('transactions', 'select')).toEqual([]);
      const rows = result.current.monthEndPreview;
      const stExpense = rows.find((r) => r.lease_id === st.id && r.account_credited === 'Cash');
      // Straight-line over the tranches: (6*1000 + 6*2000) / 12, not the 999 header amount.
      expect(stExpense).toMatchObject({ transaction_type: 'short_term_lease_expense', debit_amount: 1500, credit_amount: 1000 });
      expect(rows.find((r) => r.lease_id === stNoTranches.id)).toMatchObject({ debit_amount: 600, credit_amount: 600 });
      expect(setErrorMessage.mock.calls.every(([m]) => m === '')).toBe(true);
    });

    it('lists leases without a schedule row and keeps them in skippedLeases', async () => {
      const good = lease({ lease_name: 'Good' });
      const missing = lease({ lease_name: 'NoSchedule' });
      tables.amortization_schedules = schedule(good, 12);
      setup();
      const { result } = await preview([good, missing]);
      expect(result.current.skippedLeases).toEqual([
        expect.objectContaining({ lease_id: missing.id, lease_name: 'NoSchedule' }),
      ]);
      expect(result.current.monthEndPreview).toHaveLength(3);
      expect(lastError()).toBe(
        '1 lease(s) have no schedule row for September 2026: NoSchedule. Regenerate their schedules before posting; month-end cannot be processed while a lease would be left out.',
      );

      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(lastError()).toBe('Month-end cannot be processed while 1 lease(s) would be left out: NoSchedule.');
      expect(confirm).not.toHaveBeenCalled();
      expect(fake.writes).toEqual([]);
    });

    it('reports when no entries fall in the period', async () => {
      const future = lease({ lease_start_date: '2027-01-01' });
      tables.amortization_schedules = schedule(future, 12);
      setup();
      const { result } = await preview([future]);
      expect(result.current.monthEndPreview).toEqual([]);
      expect(lastError()).toBe('No month-end entries were found for September 2026.');
    });

    it('reports when there are no leases at all', async () => {
      setup();
      await preview([]);
      expect(lastError()).toBe('No month-end entries were found for September 2026.');
    });

    it.each([
      ['amortization_schedules', {}],
      ['lease_payment_schedules', { accounting_treatment: 'short_term_exemption' as const }],
      ['month_end_catch_up_lines', {}],
    ])('shows a generic message when loading %s fails', async (table, over) => {
      const l = lease(over);
      tables.amortization_schedules = schedule(l, 12);
      setup({ failures: { select: { [table]: 'connection reset' } } });
      const { result } = await preview([l]);
      expect(lastError()).toBe('Failed to generate the month-end preview.');
      expect(result.current.monthEndPreview).toEqual([]);
      expect(result.current.submitting).toBe(false);
    });
  });

  describe('processing', () => {
    async function readyHook(leases?: Lease[]) {
      const ls = leases ?? [lease({ lease_name: 'HQ' }), lease({ lease_name: 'Branch' })];
      tables.amortization_schedules = ls.flatMap((l) => schedule(l, 12));
      const hook = await preview(ls);
      expect(hook.result.current.monthEndPreview).toHaveLength(ls.length * 3);
      act(() => hook.result.current.setShowMonthEndModal(true));
      setErrorMessage.mockClear();
      return hook;
    }

    it('requires a preview first', async () => {
      setup();
      const { result } = renderMonthEnd([lease()]);
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(setSuccessMessage).toHaveBeenCalledWith('');
      expect(lastError()).toBe('Generate a preview first.');
      expect(confirm).not.toHaveBeenCalled();
    });

    it('does nothing when the user cancels the confirmation', async () => {
      setup();
      const { result } = await readyHook();
      confirm.mockResolvedValueOnce(false);
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Process month-end?',
        message: 'This will post 6 journal entries for September 2026.',
        confirmLabel: 'Process',
      }));
      expect(fake.writes).toEqual([]);
      expect(result.current.monthEndPreview).toHaveLength(6);
      expect(refreshData).not.toHaveBeenCalled();
    });

    it('posts a month-end document for the organization with totals and entries', async () => {
      setup();
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });

      expect(fake.writes).toHaveLength(1);
      const w = fake.writes[0];
      expect(w.op).toBe('insert');
      if (w.op !== 'insert') return;
      expect(w.table).toBe('month_end_documents');
      const doc = w.rows[0];
      expect(doc).toMatchObject({
        user_id: 'user-1',
        organization_id: 'org-1',
        period: '2026-09',
        period_label: 'September 2026',
        lease_count: 2,
        transaction_count: 6,
        total_interest: 22,
        total_depreciation: 160,
        total_principal: 2000,
        status: 'posted',
      });
      const entries = doc.entries as Record<string, unknown>[];
      expect(entries).toHaveLength(6);
      expect(entries[0]).not.toHaveProperty('lease_name');
      expect(Object.keys(entries[0]).sort()).toEqual([
        'account_credited', 'account_debited', 'credit_amount', 'debit_amount', 'description',
        'lease_id', 'period', 'reference_number', 'transaction_date', 'transaction_type',
      ]);
      const docSelects = callsFor('month_end_documents', 'select');
      expect(docSelects[docSelects.length - 1]).toEqual(['id, status']);

      expect(setSuccessMessage).toHaveBeenLastCalledWith('Month-end for September 2026 posted successfully.');
      expect(result.current.monthEndPreview).toEqual([]);
      expect(result.current.showMonthEndModal).toBe(false);
      expect(result.current.submitting).toBe(false);
      expect(refreshData).toHaveBeenCalledTimes(1);
      expect(reportCriticalError).not.toHaveBeenCalled();
    });

    it("stamps the document with the signed-in user's organization, not a lease's", async () => {
      vi.mocked(currentOrgId).mockResolvedValue('org-9');
      setup();
      const ls = [lease({ organization_id: '' }), lease({ organization_id: 'org-1' })];
      const { result } = await readyHook(ls);
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      const w = fake.writes[0];
      expect(w.op === 'insert' && w.rows[0].organization_id).toBe('org-9');
    });

    it('reports a pending-approval outcome when the database holds the document for approval', async () => {
      setup({}, { month_end_documents: { data: { id: 'doc-1', status: 'pending' }, error: null } });
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(setSuccessMessage).toHaveBeenLastCalledWith(
        'Month-end for September 2026 sent for approval. Entries will post once approved in Settings > Approval.',
      );
      expect(callsFor('month_end_documents', 'insert')[0][0]).toMatchObject({ status: 'posted', organization_id: 'org-1' });
      expect(result.current.monthEndPreview).toEqual([]);
      expect(result.current.showMonthEndModal).toBe(false);
      expect(refreshData).toHaveBeenCalledTimes(1);
    });

    it('requires a signed-in user', async () => {
      setup({ signedOut: true });
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(lastError()).toBe('You must be signed in.');
      expect(fake.writes).toEqual([]);
      expect(result.current.submitting).toBe(false);
    });

    it('stops with a clear message when the organization cannot be identified', async () => {
      setup();
      const { result } = await readyHook();
      vi.mocked(currentOrgId).mockRejectedValueOnce(new UserFacingError('Your account is not linked to an organization. Please contact your administrator.'));
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(lastError()).toBe('Your account is not linked to an organization. Please contact your administrator.');
      expect(fake.writes).toEqual([]);
    });

    it('reports and surfaces an insert error, keeping the preview', async () => {
      setup({ failures: { write: { month_end_documents: 'duplicate key value violates unique constraint' } } });
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(reportCriticalError).toHaveBeenCalledWith(expect.anything(), 'month_end', { message: 'duplicate key value violates unique constraint' });
      expect(lastError()).toBe('Failed to create month-end document.');
      expect(result.current.monthEndPreview).toHaveLength(6);
      expect(result.current.showMonthEndModal).toBe(true);
      expect(refreshData).not.toHaveBeenCalled();
      expect(result.current.submitting).toBe(false);
    });

    it('passes through intentional guard messages from the insert', async () => {
      setup({}, { month_end_documents: { data: null, error: { message: 'Cannot post into a closed period' } } });
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(lastError()).toBe('Cannot post into a closed period');
    });

    it('treats an empty insert response as a failure without reporting it', async () => {
      setup({}, { month_end_documents: { data: null, error: null } });
      const { result } = await readyHook();
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(reportCriticalError).not.toHaveBeenCalled();
      expect(lastError()).toBe('Failed to create month-end document.');
    });

    it('reports unexpected exceptions thrown while processing', async () => {
      setup();
      const { result } = await readyHook();
      const boom = new Error('socket hang up');
      (h.client.auth as { getUser: () => Promise<unknown> }).getUser = () => Promise.reject(boom);
      await act(async () => { await result.current.handleProcessMonthEnd(); });
      expect(reportCriticalError).toHaveBeenCalledWith(expect.anything(), 'month_end', boom);
      expect(lastError()).toBe('Failed to process month-end.');
      expect(result.current.submitting).toBe(false);
    });
  });
});

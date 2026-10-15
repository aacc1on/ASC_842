/**
 * Flow test: month-end preview -> post -> period locked -> reopen (latest month only).
 *
 * Renders the real TransactionsView (Month-End modal) and MonthEndDocumentsView
 * inside the real ToastProvider (confirm dialogs) on top of the in-memory
 * Supabase fake. Two database behaviours are simulated in this file because the
 * fake has no triggers:
 *  - posting a `month_end_documents` row explodes its `entries` into
 *    `transactions` rows linked by `month_end_document_id` and marks prepared
 *    catch-up batches for that period as posted;
 *  - deleting a document cascades to its transactions.
 * Amounts are only checked for balance (debits = credits), never recomputed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within, cleanup, configure, getConfig } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionsView } from '../../components/TransactionsView';
import { MonthEndDocumentsView } from '../../components/MonthEndDocumentsView';
import { ToastProvider } from '../../components/ToastContext';
import type { UserPermissions } from '../../App';
import { createFakeSupabase, type Write } from '../fixtures/fakeSupabase';
import {
  buildGoldenPortfolio,
  leaseId,
  GOLDEN_ORG,
  GOLDEN_TODAY,
  GOLDEN_USER,
  LAST_POSTED_PERIOD,
  type Row,
  type Tables,
} from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }),
}));

const PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: false,
  access_user_management: false,
};

const NEXT_PERIOD = '2026-07';

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;

const label = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
};

/** Server-side paginated transaction list, newest first (mirrors get_filtered_transactions). */
function filteredTransactionsRpc(args: Record<string, unknown>, t: Tables) {
  const page = Number(args.p_page ?? 1);
  const size = Number(args.p_page_size ?? 25);
  const leaseNames = new Map(t.leases.map((l) => [l.id, l.lease_name]));
  const all = [...t.transactions]
    .sort((a, b) => (String(a.transaction_date) < String(b.transaction_date) ? 1 : String(a.transaction_date) > String(b.transaction_date) ? -1 : 0))
    .map((r) => ({ ...r, lease_name: r.lease_name ?? leaseNames.get(r.lease_id) }));
  return { rows: all.slice((page - 1) * size, page * size), total_count: all.length };
}

/** Simulated trigger: a posted document's entries become linked `transactions` rows. */
function explodePostedDocument(doc: Row) {
  doc.created_at ??= '2026-10-12T12:00:00Z'; // column default
  if (doc.status !== 'posted') return;
  const entries = (doc.entries as Row[] | undefined) ?? [];
  entries.forEach((e, i) => {
    tables.transactions.push({
      id: `tx-posted-${String(doc.id)}-${i + 1}`,
      organization_id: doc.organization_id,
      user_id: doc.user_id,
      month_end_document_id: doc.id,
      is_reversed: false,
      created_at: '2026-10-12T12:00:00Z',
      ...e,
    });
  });
  for (const b of tables.month_end_catch_up_batches) {
    if (b.posting_period === doc.period && b.status === 'prepared') b.status = 'posted';
  }
}

function setup(opts: { withCatchUps?: boolean; failDocInsert?: string } = {}) {
  tables = buildGoldenPortfolio().tables;
  // Only leases that were posted month by month in the portfolio take part
  // (the fixture never posted the cancelled/expired leases' historical months).
  const active = new Set(tables.leases.filter((l) => l.status === 'active').map((l) => l.id));
  tables.leases = tables.leases.filter((l) => active.has(l.id));
  tables.amortization_schedules = tables.amortization_schedules.filter((r) => active.has(r.lease_id));
  tables.transactions = tables.transactions.filter((r) => active.has(r.lease_id));
  tables.lease_transactions = tables.lease_transactions.filter((r) => active.has(r.lease_id));
  // Drop the 2026-07 draft and give posted documents the label/summary columns the app writes.
  tables.month_end_documents = tables.month_end_documents
    .filter((d) => d.status === 'posted')
    .map((d) => {
      const txs = tables.transactions.filter((t) => t.month_end_document_id === d.id);
      return {
        ...d,
        period_label: label(String(d.period)),
        transaction_count: txs.length,
        lease_count: new Set(txs.map((t) => t.lease_id)).size,
        total_interest: 0,
        total_depreciation: 0,
        total_principal: 0,
      };
    });
  tables.month_end_catch_up_batches = [];
  tables.month_end_catch_up_lines = [];
  tables.lease_payment_schedules = [];
  if (opts.withCatchUps) {
    tables.month_end_catch_up_batches.push(
      {
        id: 'cub-1', lease_id: leaseId(1), posting_period: LAST_POSTED_PERIOD, description: 'Catch-up for HQ Office',
        first_missed_period: '2026-04', last_missed_period: '2026-05', missed_months: 2,
        total_interest: 100, total_amortization: 200, total_payment: 300, total_debits: 600, total_credits: 600, status: 'posted',
      },
      {
        id: 'cub-2', lease_id: leaseId(2), posting_period: NEXT_PERIOD, description: 'Catch-up for Retail Unit',
        first_missed_period: '2026-05', last_missed_period: '2026-05', missed_months: 1,
        total_interest: 10, total_amortization: 20, total_payment: 30, total_debits: 60, total_credits: 60, status: 'prepared',
      },
      {
        id: 'cub-3', lease_id: leaseId(4), posting_period: '2026-09', description: 'Catch-up for Warehouse',
        first_missed_period: '2026-03', last_missed_period: '2026-04', missed_months: 2,
        total_interest: 5, total_amortization: 6, total_payment: 7, total_debits: 18, total_credits: 18, status: 'prepared',
      },
    );
    tables.month_end_catch_up_lines.push(
      { id: 'cul-1', batch_id: 'cub-1', lease_id: leaseId(1), missed_period: '2026-04', component: 'interest', account_debited: 'Interest Expense', account_credited: 'Lease Liability', amount: 100 },
      { id: 'cul-2', batch_id: 'cub-1', lease_id: leaseId(1), missed_period: '2026-05', component: 'payment', account_debited: 'Lease Liability', account_credited: 'Cash', amount: 300 },
    );
  }

  fake = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    rpc: { get_filtered_transactions: filteredTransactionsRpc },
    failures: opts.failDocInsert ? { write: { month_end_documents: opts.failDocInsert } } : undefined,
  });
  const baseFrom = fake.from;
  h.client = {
    ...fake,
    from: (table: string) => {
      const q = baseFrom(table);
      if (table !== 'month_end_documents') return q;
      const insert = q.insert.bind(q);
      q.insert = (rows: Row | Row[]) => {
        const r = insert(rows);
        const then = r.then.bind(r);
        r.then = ((ok, fail) => then((res) => {
          if (!res.error) {
            const list = Array.isArray(rows) ? rows : [rows];
            const stored = tables.month_end_documents.slice(-list.length);
            stored.forEach(explodePostedDocument);
          }
          return res;
        }).then(ok, fail)) as typeof r.then;
        return r;
      };
      const del = q.delete.bind(q);
      q.delete = () => {
        const r = del();
        const eq = r.eq.bind(r);
        r.eq = (c: string, v: unknown) => {
          if (c === 'id') tables.transactions = tables.transactions.filter((t) => t.month_end_document_id !== v);
          return eq(c, v);
        };
        return r;
      };
      return q;
    },
  };
}

const writesTo = (table: string, op?: Write['op']) =>
  fake.writes.filter((w) => w.table === table && (!op || w.op === op));

const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

async function openMonthEnd() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <TransactionsView permissions={PERMISSIONS} selectedCompanyId={null} />
    </ToastProvider>,
  );
  // Transactions load twice (before and after the lease list arrives); wait for both.
  await waitFor(() => expect(fake.calls.filter((c) => c.fn === 'get_filtered_transactions').length).toBeGreaterThanOrEqual(2));
  // The view renders slowly under a parallel full-suite run; allow more than the default 1s.
  await user.click(await screen.findByRole('button', { name: 'Month-End' }, { timeout: 8000 }));
  await screen.findByRole('heading', { name: 'Month-End Processing' }, { timeout: 8000 });
  const periodInput = () => document.querySelector('input[type="month"]') as HTMLInputElement;
  const preview = async (period: string) => {
    await waitFor(() => expect(periodInput()).not.toBeNull(), { timeout: 8000 });
    fireEvent.change(periodInput(), { target: { value: period } });
    await user.click(screen.getByRole('button', { name: 'Generate Preview' }));
  };
  return { user, periodInput, preview };
}

function confirmDialog() {
  return screen.getByRole('heading', { name: /Please confirm|Process month-end\?/ }).closest('div.bg-white') as HTMLElement;
}

async function renderDocuments() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <MonthEndDocumentsView selectedCompanyId={null} />
    </ToastProvider>,
  );
  await screen.findAllByRole('button', { name: /Delete/ });
  const card = (period: string) =>
    screen.getByRole('heading', { level: 3, name: label(period) }).closest('div.border-2') as HTMLElement;
  return { user, card };
}

// TransactionsView is heavy (double load + full-screen spinner); under a parallel suite run the default 1s
// async-util timeout is too tight. Scoped to this file and restored afterwards.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => configure({ asyncUtilTimeout: 8000 }));
afterAll(() => configure({ asyncUtilTimeout: defaultAsyncTimeout }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Month-end flow: preview, post, lock and reopen', () => {
  it('journey: preview July 2026 balances, posts a document and locks the period', async () => {
    setup({ withCatchUps: true });
    const ctx = await openMonthEnd();

    // Defaults to the current (unfinished) month.
    expect(ctx.periodInput().value).toBe('2026-10');

    await ctx.preview(NEXT_PERIOD);
    const countText = await screen.findByText(/\d+ entries to post/);
    const entryCount = Number(countText.textContent!.match(/(\d+)/)![1]);
    expect(entryCount).toBeGreaterThan(0);
    const totals = screen.getByText(/^Debits .* · Credits /).textContent!;
    const [, dr, cr] = totals.match(/^Debits (.+) · Credits (.+)$/)!;
    expect(dr).toBe(cr);

    // The prepared catch-up batch for this period is shown inside the modal.
    expect(screen.getByText('Catch-up corrections')).toBeInTheDocument();
    expect(screen.getByText(/Prepared, not posted yet\. They post automatically when July 2026 month-end is processed\./)).toBeInTheDocument();

    await ctx.user.click(screen.getByRole('button', { name: 'Process Month-End' }));
    const dlg = confirmDialog();
    expect(within(dlg).getByText(`This will post ${entryCount} journal entries for July 2026.`)).toBeInTheDocument();
    await ctx.user.click(within(dlg).getByRole('button', { name: 'Process' }));

    // refreshData() reloads the list (spinner) before the success banner settles.
    await waitFor(() => expect(screen.getByText('Month-end for July 2026 posted successfully.')).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.queryByRole('heading', { name: 'Month-End Processing' })).not.toBeInTheDocument();

    const docInserts = writesTo('month_end_documents', 'insert') as unknown as { rows: Record<string, unknown>[] }[];
    expect(docInserts).toHaveLength(1);
    const doc = docInserts[0].rows[0];
    expect(doc).toMatchObject({
      user_id: GOLDEN_USER,
      organization_id: GOLDEN_ORG,
      period: NEXT_PERIOD,
      period_label: 'July 2026',
      status: 'posted',
      transaction_count: entryCount,
    });
    const entries = doc.entries as Row[];
    expect(entries).toHaveLength(entryCount);
    expect(entries.every((e) => e.period === NEXT_PERIOD)).toBe(true);
    expect(sum(entries, 'debit_amount')).toBeCloseTo(sum(entries, 'credit_amount'), 2);
    for (const e of entries) expect(Number(e.debit_amount)).toBeCloseTo(Number(e.credit_amount), 2);
    expect(doc.lease_count).toBe(new Set(entries.map((e) => e.lease_id)).size);
    // Summary columns equal the sums of the typed entries.
    const byType = (type: string) => sum(entries.filter((e) => e.transaction_type === type), 'debit_amount');
    expect(Number(doc.total_interest)).toBeCloseTo(byType('interest'), 2);
    expect(Number(doc.total_depreciation)).toBeCloseTo(byType('amortization'), 2);
    expect(Number(doc.total_principal)).toBeCloseTo(byType('payment'), 2);

    // Period is now locked: a second preview for July is refused, nothing more is written.
    await ctx.user.click(await screen.findByRole('button', { name: 'Month-End' }, { timeout: 10000 }));
    await ctx.preview(NEXT_PERIOD);
    expect((await screen.findAllByText(`Month-end has already been processed for ${NEXT_PERIOD}.`)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/entries to post/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Process Month-End' })).toBeDisabled();
    expect(writesTo('month_end_documents', 'insert')).toHaveLength(1);
  }, 60000);

  it('documents: an earlier posted month refuses to reopen; the latest month reopens and then the previous one becomes reopenable', async () => {
    const { user, card } = await renderDocuments();
    const latest = LAST_POSTED_PERIOD; // 2026-06
    const earlier = '2026-05';

    await user.click(within(card(earlier)).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Remove later months first (latest posted: June 2026)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Please confirm' })).not.toBeInTheDocument();
    expect(writesTo('month_end_documents', 'delete')).toHaveLength(0);

    await user.click(within(card(latest)).getByRole('button', { name: 'Delete' }));
    const dlg = confirmDialog();
    expect(within(dlg).getByText(/Delete month-end document for June 2026\?/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Month-end document for June 2026 and all its transactions have been deleted.')).toBeInTheDocument();
    expect(writesTo('month_end_documents', 'delete')).toEqual([{ op: 'delete', table: 'month_end_documents', matched: 1 }]);
    expect(tables.month_end_documents.some((d) => d.period === latest)).toBe(false);
    expect(tables.transactions.some((t) => t.period === latest && t.month_end_document_id)).toBe(false);
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: 'June 2026' })).not.toBeInTheDocument());

    // May is now the latest posted month, so it can be reopened (confirm shown, then cancelled).
    await user.click(within(card(earlier)).getByRole('button', { name: 'Delete' }));
    const dlg2 = confirmDialog();
    expect(within(dlg2).getByText(/Delete month-end document for May 2026\?/)).toBeInTheDocument();
    await user.click(within(dlg2).getByRole('button', { name: 'Cancel' }));
    expect(writesTo('month_end_documents', 'delete')).toHaveLength(1);
    expect(tables.month_end_documents.some((d) => d.period === earlier)).toBe(true);
  });

  it('after posting a new month, the month before it is refused and the new month can be reopened (unlocking the period)', async () => {
    const ctx = await openMonthEnd();
    await ctx.preview(NEXT_PERIOD);
    await screen.findByText(/\d+ entries to post/);
    await ctx.user.click(screen.getByRole('button', { name: 'Process Month-End' }));
    await ctx.user.click(within(confirmDialog()).getByRole('button', { name: 'Process' }));
    await waitFor(() => expect(screen.getByText('Month-end for July 2026 posted successfully.')).toBeInTheDocument(), { timeout: 8000 });
    cleanup();

    const { user, card } = await renderDocuments();
    await user.click(within(card(LAST_POSTED_PERIOD)).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Remove later months first (latest posted: July 2026)')).toBeInTheDocument();
    expect(writesTo('month_end_documents', 'delete')).toHaveLength(0);

    await user.click(within(card(NEXT_PERIOD)).getByRole('button', { name: 'Delete' }));
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Month-end document for July 2026 and all its transactions have been deleted.')).toBeInTheDocument();
    expect(tables.transactions.some((t) => t.period === NEXT_PERIOD)).toBe(false);
  });

  it('refuses months that have not ended yet and months processed out of order', async () => {
    const ctx = await openMonthEnd();

    await ctx.preview('2026-10');
    expect((await screen.findAllByText('October 2026 has not ended yet. Month-end can be processed only after the last day of the month.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/entries to post/)).not.toBeInTheDocument();

    await ctx.preview('2026-09');
    expect((await screen.findAllByText(/^July 2026 has not been processed yet \(.+\)\. Process month-end for earlier months in order before September 2026\.$/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/entries to post/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Process Month-End' })).toBeDisabled();

    await ctx.preview(LAST_POSTED_PERIOD);
    expect((await screen.findAllByText(`Month-end has already been processed for ${LAST_POSTED_PERIOD}.`)).length).toBeGreaterThan(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('cancelling the confirm dialog or a failed insert posts nothing', async () => {
    setup({ failDocInsert: 'duplicate key value violates unique constraint "month_end_documents_org_period_key"' });
    const ctx = await openMonthEnd();
    await ctx.preview(NEXT_PERIOD);
    await screen.findByText(/\d+ entries to post/);

    await ctx.user.click(screen.getByRole('button', { name: 'Process Month-End' }));
    await ctx.user.click(within(confirmDialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/\d+ entries to post/)).toBeInTheDocument();
    expect(fake.writes).toHaveLength(0);

    await ctx.user.click(screen.getByRole('button', { name: 'Process Month-End' }));
    await ctx.user.click(within(confirmDialog()).getByRole('button', { name: 'Process' }));
    expect((await screen.findAllByText('Failed to create month-end document.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/posted successfully/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument();
    // Only the error report is written; no document and no journal entries.
    expect(fake.writes.filter((w) => w.table !== 'error_logs')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Month-End Processing' })).toBeInTheDocument();
    expect(tables.month_end_documents.some((d) => d.period === NEXT_PERIOD)).toBe(false);
    expect(tables.transactions.some((t) => t.period === NEXT_PERIOD)).toBe(false);
  });

  it('catch-up corrections render: undocumented prepared periods at the top, posted batches inside the expanded document with line detail', async () => {
    setup({ withCatchUps: true });
    const { user, card } = await renderDocuments();

    // 2026-07 and 2026-09 have prepared batches but no document yet -> compact sections at the top.
    const sections = await screen.findAllByRole('heading', { name: 'Catch-up corrections' });
    expect(sections).toHaveLength(2);
    expect(screen.getByText(/booked in July 2026\. Prepared, not posted yet/)).toBeInTheDocument();
    expect(screen.getByText(/booked in September 2026\. Prepared, not posted yet/)).toBeInTheDocument();

    // Expanding June 2026 shows its posted transactions and the posted catch-up batch.
    await user.click(within(card(LAST_POSTED_PERIOD)).getByRole('heading', { level: 3, name: 'June 2026' }));
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Catch-up corrections' })).toHaveLength(3));
    const juneCard = card(LAST_POSTED_PERIOD);
    expect(within(juneCard).getByText(/2 missed months · booked in June 2026\. Posted with this month-end\./)).toBeInTheDocument();
    expect(within(juneCard).getByText('HQ Office (finance, monthly, arrears)', { selector: 'span' })).toBeInTheDocument();
    // Batch header ties: Debits = Credits.
    const header = within(juneCard).getByText(/^Debits/, { selector: 'div' }).parentElement!;
    expect(within(header).getAllByText('$600.00')).toHaveLength(2);

    await user.click(within(juneCard).getByRole('button', { expanded: false, name: /HQ Office/ }));
    expect(await within(juneCard).findByText('Missed month')).toBeInTheDocument();
    expect(within(juneCard).getByText('April 2026')).toBeInTheDocument();
    expect(within(juneCard).getByText('May 2026')).toBeInTheDocument();
    expect(within(juneCard).getByText('$300.00', { selector: 'td' })).toBeInTheDocument();
  });
});

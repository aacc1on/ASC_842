/**
 * Flow test (f): reports footing.
 *
 * Renders the real ReportsView (real useReportsBaseData / useFinancialReportsData /
 * useComplianceData hooks) on an in-memory Supabase fake seeded with the golden
 * portfolio, navigates by clicking the report tabs, and checks from the rendered
 * DOM text that:
 *   - the Balance Sheet foots (gross − accumulated − impairment = net ROU,
 *     finance + operating accumulated = accumulated, current + long-term = total
 *     liabilities, header chips = statement totals). Under ASC 842 ROU assets and
 *     lease liabilities are measured separately, so "assets = liabilities" is NOT
 *     an identity of this statement (the report itself says so) and is not asserted.
 *   - the Compliance Maturity Analysis foots (buckets = total undiscounted,
 *     total − imputed interest = PV) and its PV (finance + operating) ties to the
 *     Balance Sheet total lease liability at the same as-of date.
 *
 * Scope match: the Balance Sheet (as of the Financial period end) includes every
 * filtered lease whose schedule balance is `active`, excluding cancelled and
 * short-term-exempt leases. The Maturity Analysis (as of the Compliance "To" date)
 * includes status='active' leases overlapping the compliance period, again
 * excluding cancelled / short-term / terminated leases and requiring an `active`
 * balance. On the golden data the two scopes coincide when both dates are equal.
 * All amounts are displayed in whole dollars, so cross-report ties allow $1 per
 * independently-rounded component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReportsView } from '../../components/reports/ReportsView';
import { createFakeSupabase } from '../fixtures/fakeSupabase';
import { goldenPortfolioTotalsRpc } from '../golden/goldenRpc';
import {
  buildGoldenPortfolio,
  leaseId,
  GOLDEN_AS_OF,
  GOLDEN_TODAY,
  GOLDEN_USER,
  type Tables,
} from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }),
}));

let tables: Tables;

function setup(mutate?: (t: Tables) => void) {
  tables = buildGoldenPortfolio().tables;
  tables.lease_impairments = [];
  mutate?.(tables);
  h.client = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    rpc: { get_lease_portfolio_totals: goldenPortfolioTotalsRpc },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Parses "$1,234", "-$1,234", "($1,234)" into a number. */
function money(text: string | null | undefined): number {
  const raw = (text ?? '').trim();
  const neg = /^\(.*\)$/.test(raw) || raw.includes('-') || raw.includes('−');
  const digits = raw.replace(/[^0-9.]/g, '');
  if (digits === '') throw new Error(`not a currency amount: "${raw}"`);
  const v = Number(digits);
  return neg ? -v : v;
}

function bsCard(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Balance Sheet' });
  return heading.closest('div.rounded-2xl') as HTMLElement;
}

/** Amount displayed next to a Balance Sheet row label (row = flex container with label + amount). */
function bsAmount(label: string): number {
  const span = within(bsCard()).getByText(label, { selector: 'span' });
  return money(span.parentElement!.lastElementChild!.textContent);
}

function bsChip(label: string): number {
  const p = within(bsCard()).getByText(label, { selector: 'p' });
  return money(p.nextElementSibling!.textContent);
}

interface BalanceSheetView {
  asOf: string;
  gross: number;
  accumulated: number;
  accFinance: number;
  accOperating: number;
  impairment: number;
  netRou: number;
  current: number;
  longTerm: number;
  total: number;
  chipNetRou: number;
  chipLiabilities: number;
}

function readBalanceSheet(): BalanceSheetView {
  const card = bsCard();
  const impairmentLabel = within(card).queryByText('Less: Accumulated impairment', { selector: 'span' });
  return {
    asOf: within(card).getByText(/^As of /).textContent ?? '',
    gross: bsAmount('Right-of-Use Assets (Gross)'),
    accumulated: bsAmount('Less: Accumulated amortization'),
    accFinance: bsAmount('Accumulated amortization (finance)'),
    accOperating: bsAmount('Accumulated ROU amortization (operating — straight-line cost less interest)'),
    impairment: impairmentLabel ? bsAmount('Less: Accumulated impairment') : 0,
    netRou: bsAmount('Net ROU Assets'),
    current: bsAmount('Current Lease Liabilities'),
    longTerm: bsAmount('Long-term Lease Liabilities'),
    total: bsAmount('Total Liabilities'),
    chipNetRou: bsChip('Net ROU'),
    chipLiabilities: bsChip('Liabilities'),
  };
}

function expectBalanceSheetFoots(bs: BalanceSheetView) {
  // Displayed in whole dollars by footing helpers; rows must add exactly (tolerance 1 cent for float).
  expect(Math.abs(bs.gross - bs.accumulated - bs.impairment - bs.netRou)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(bs.accFinance + bs.accOperating - bs.accumulated)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(bs.current + bs.longTerm - bs.total)).toBeLessThanOrEqual(0.01);
  expect(bs.chipNetRou).toBe(bs.netRou);
  expect(bs.chipLiabilities).toBe(bs.total);
  // The narrative line repeats both totals.
  const narrative = within(bsCard()).getByText(/ROU assets vs lease liabilities/).parentElement!.textContent!;
  const amounts = narrative.match(/-?\$[\d,]+/g)!.map(money);
  expect(amounts).toEqual([bs.netRou, bs.total]);
}

interface MaturityView {
  buckets: number[];
  total: number;
  interest: number;
  pv: number;
  leaseCount: string;
}

function readMaturity(label: 'Finance Leases' | 'Operating Leases'): MaturityView {
  const heading = screen.getByRole('heading', { name: label });
  const card = heading.closest('div.rounded-2xl') as HTMLElement;
  const rows = within(card).getAllByRole('row').map((tr) => {
    const cells = tr.querySelectorAll('td');
    return { label: cells[0].textContent ?? '', value: money(cells[1].textContent) };
  });
  const find = (l: string) => rows.find((r) => r.label === l)!.value;
  const fixed = ['Total Undiscounted Lease Payments', 'Less: Imputed Interest', 'Present Value of Lease Liability'];
  return {
    buckets: rows.filter((r) => !fixed.includes(r.label)).map((r) => r.value),
    total: find(fixed[0]),
    // Shown as "($X)" — a deduction; use its magnitude.
    interest: Math.abs(find(fixed[1])),
    pv: find(fixed[2]),
    leaseCount: heading.nextElementSibling!.textContent ?? '',
  };
}

function expectMaturityFoots(m: MaturityView) {
  expect(m.buckets).toHaveLength(6);
  expect(Math.abs(m.buckets.reduce((a, b) => a + b, 0) - m.total)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(m.total - m.interest - m.pv)).toBeLessThanOrEqual(0.01);
}

async function openReports() {
  const user = userEvent.setup();
  render(<MemoryRouter><ReportsView /></MemoryRouter>);
  await screen.findByText('Lease Portfolio Reports', {}, { timeout: 5000 });
  return user;
}

async function openBalanceSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Financial Reports/ }));
  await screen.findByRole('heading', { name: 'Balance Sheet' }, { timeout: 5000 });
}

async function waitForBalanceSheetAsOf(text: string) {
  await waitFor(() => expect(within(bsCard()).getByText(/^As of /).textContent).toBe(`As of ${text}`), { timeout: 5000 });
}

async function openMaturity(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Compliance$/ }));
  await user.click(await screen.findByRole('button', { name: /Maturity Analysis/ }));
  await screen.findByRole('heading', { name: 'Finance Leases' });
}

/** Waits for the async maturity load to land (PV non-zero once balances are fetched). */
async function waitForMaturity(predicate: (fin: MaturityView, op: MaturityView) => boolean) {
  await waitFor(() => expect(predicate(readMaturity('Finance Leases'), readMaturity('Operating Leases'))).toBe(true), { timeout: 5000 });
}

function setComplianceTo(date: string) {
  const input = screen.getByText('To', { selector: 'label' }).parentElement!.querySelector('input')!;
  fireEvent.change(input, { target: { value: date } });
}

describe('reports footing flow (balance sheet ↔ maturity analysis)', () => {
  it('journey: balance sheet as of the default period end foots, and maturity analysis at the same date ties to its liability', async () => {
    // The golden fixture records the depot impairment only as a lease_transactions event; the
    // balance sheet reads approved rows from lease_impairments, so seed the matching row here.
    setup((t) => {
      t.lease_impairments = [{
        id: 'imp-1', lease_id: leaseId(7), impairment_date: '2026-03-31', impairment_amount: 10000, status: 'approved',
      }];
    });
    const user = await openReports();
    await openBalanceSheet(user);
    // Default period = previous month relative to GOLDEN_TODAY → September 2026.
    expect(GOLDEN_AS_OF).toBe('2026-09-30');
    await waitForBalanceSheetAsOf('September 30, 2026');
    const bs = readBalanceSheet();
    expectBalanceSheetFoots(bs);
    expect(bs.total).toBeGreaterThan(0);
    expect(bs.netRou).toBeGreaterThan(0);
    // The golden depot impairment (10,000) is presented on its own line.
    expect(bs.impairment).toBeGreaterThan(0);
    expect(screen.getByText(/Showing/).textContent).toMatch(/Showing\s*11\s*of 11 leases/);

    await openMaturity(user);
    // Q3 preset puts the compliance "To" date on the same as-of date as the balance sheet.
    await user.click(screen.getByRole('button', { name: 'Q3' }));
    const toInput = screen.getByText('To', { selector: 'label' }).parentElement!.querySelector('input')!;
    expect(toInput.value).toBe(GOLDEN_AS_OF);
    await waitForMaturity((f, o) => f.pv + o.pv > 0);
    const fin = readMaturity('Finance Leases');
    const op = readMaturity('Operating Leases');
    expectMaturityFoots(fin);
    expectMaturityFoots(op);
    // Tie: total undiscounted − imputed interest (both classes) = balance sheet lease liability.
    const tie = fin.total - fin.interest + (op.total - op.interest);
    expect(Math.abs(tie - bs.total)).toBeLessThanOrEqual(1);
    expect(Math.abs(fin.pv + op.pv - bs.total)).toBeLessThanOrEqual(1);
    // Undiscounted payments always exceed their present value at positive rates.
    expect(fin.interest).toBeGreaterThan(0);
    expect(op.interest).toBeGreaterThan(0);
  });

  it('changing the period re-foots the balance sheet and the maturity tie still holds at the new as-of date', async () => {
    setup();
    const user = await openReports();
    await openBalanceSheet(user);
    await waitForBalanceSheetAsOf('September 30, 2026');
    const sept = readBalanceSheet();

    await user.click(screen.getByTitle('Previous period'));
    await waitForBalanceSheetAsOf('August 31, 2026');
    await waitFor(() => expect(readBalanceSheet().total).not.toBe(sept.total), { timeout: 5000 });
    const aug = readBalanceSheet();
    expectBalanceSheetFoots(aug);
    // A month of principal repayment between Aug and Sep: liability is higher a month earlier.
    expect(aug.total).toBeGreaterThan(sept.total);

    await openMaturity(user);
    setComplianceTo('2026-08-31');
    await waitForMaturity((f, o) => Math.abs(f.pv + o.pv - aug.total) <= 1);
    const fin = readMaturity('Finance Leases');
    const op = readMaturity('Operating Leases');
    expectMaturityFoots(fin);
    expectMaturityFoots(op);
    expect(Math.abs(fin.total - fin.interest + op.total - op.interest - aug.total)).toBeLessThanOrEqual(1);
  });

  it('day and year period modes also foot (as-of = selected day / year end)', async () => {
    setup();
    const user = await openReports();
    await openBalanceSheet(user);
    await waitForBalanceSheetAsOf('September 30, 2026');

    await user.click(screen.getByRole('button', { name: 'Day' }));
    const dayInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dayInput, { target: { value: '2026-03-31' } });
    await waitForBalanceSheetAsOf('March 31, 2026');
    await waitFor(() => expectBalanceSheetFoots(readBalanceSheet()), { timeout: 5000 });
    const march = readBalanceSheet();
    expect(march.total).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Year' }));
    await waitForBalanceSheetAsOf('December 31, 2026');
    await waitFor(() => expect(readBalanceSheet().total).not.toBe(march.total), { timeout: 5000 });
    const yearEnd = readBalanceSheet();
    expectBalanceSheetFoots(yearEnd);
    expect(yearEnd.total).toBeLessThan(march.total);
  });

  it('per-lease breakdowns (opened by clicking a line amount) sum to the line total shown on the statement', async () => {
    setup();
    const user = await openReports();
    await openBalanceSheet(user);
    await waitForBalanceSheetAsOf('September 30, 2026');
    const bs = readBalanceSheet();
    const lines: [string, number][] = [
      ['Current Lease Liabilities', bs.current],
      ['Long-term Lease Liabilities', bs.longTerm],
      ['Right-of-Use Assets (Gross)', bs.gross],
    ];
    for (const [label, shown] of lines) {
      const btn = within(bsCard()).getByText(label, { selector: 'span' }).parentElement!.querySelector('button')!;
      await user.click(btn);
      const title = await screen.findByRole('heading', { name: label });
      const panel = title.closest('div.relative') as HTMLElement;
      const total = money(within(panel).getByText('Total').nextElementSibling!.textContent);
      const items = [...panel.querySelectorAll('.divide-y > div')].map((row) => money(row.querySelector('p.font-bold')!.textContent));
      expect(items.length).toBeGreaterThan(0);
      // Panel shows cents: per-lease rows sum to the panel total (≤ ½ cent rounding per row).
      expect(Math.abs(items.reduce((a, b) => a + b, 0) - total)).toBeLessThanOrEqual(0.005 * items.length + 0.001);
      // Statement shows whole dollars footed to the rounded total: within $1 of the exact amount.
      expect(Math.abs(total - shown)).toBeLessThanOrEqual(1);
      // Close the panel (its first button is the X).
      await user.click(within(panel).getAllByRole('button')[0]);
      await waitFor(() => expect(screen.queryByRole('heading', { name: label })).toBeNull());
    }
    expect(bs.current + bs.longTerm).toBe(bs.total);
  });

  it('portfolio with only zero-balance leases (not yet commenced + short-term) renders $0 everywhere and still foots/ties', async () => {
    setup((t) => {
      t.leases = t.leases.filter((l) => l.id === leaseId(9) || l.id === leaseId(11));
    });
    const user = await openReports();
    await openBalanceSheet(user);
    await waitForBalanceSheetAsOf('September 30, 2026');
    const bs = readBalanceSheet();
    expectBalanceSheetFoots(bs);
    for (const v of [bs.gross, bs.accumulated, bs.accFinance, bs.accOperating, bs.impairment, bs.netRou, bs.current, bs.longTerm, bs.total]) {
      expect(v).toBe(0);
    }

    await openMaturity(user);
    await user.click(screen.getByRole('button', { name: 'Q3' }));
    const fin = readMaturity('Finance Leases');
    const op = readMaturity('Operating Leases');
    expectMaturityFoots(fin);
    expectMaturityFoots(op);
    expect([fin.total, fin.interest, fin.pv, op.total, op.interest, op.pv]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(fin.pv + op.pv).toBe(bs.total);
  });

  it('empty portfolio: balance sheet is replaced by a "no leases" notice; maturity analysis shows zeros and foots', async () => {
    setup((t) => { t.leases = []; });
    const user = await openReports();
    await user.click(screen.getByRole('button', { name: /Financial Reports/ }));
    expect(await screen.findByText('No leases match the selected filters.')).toBeInTheDocument();
    expect(screen.getByText(/Showing/).textContent).toMatch(/Showing\s*0\s*of 0 leases/);
    // By design FinancialReports renders no statement when there are no leases (balanceSheet = null).
    expect(screen.queryByRole('heading', { name: 'Balance Sheet' })).toBeNull();

    await openMaturity(user);
    const fin = readMaturity('Finance Leases');
    const op = readMaturity('Operating Leases');
    expectMaturityFoots(fin);
    expectMaturityFoots(op);
    expect(fin.pv + op.pv).toBe(0);
    expect(fin.leaseCount).toBe('0 leases');
    expect(op.leaseCount).toBe('0 leases');
  });
});

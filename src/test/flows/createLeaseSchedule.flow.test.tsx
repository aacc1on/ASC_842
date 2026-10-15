/**
 * Flow: create a lease in the real LeaseForm -> the atomic `save_lease` RPC receives the lease, a generated
 * amortization schedule and the initial recognition journal lines.
 *
 * Supabase is the in-memory fake (hoisted Proxy). The fake has no `ilike`, so the duplicate-name lookup is
 * mapped to an exact `eq` match (names are typed with the stored casing). Amount checks are balance/tie checks
 * only: the schedule rolls forward, principal retires the opening liability, and the recognition lines net to
 * the ROU asset and lease liability sent in the same payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaseForm } from '../../components/LeaseForm';
import { DUPLICATE_NAME_MESSAGE } from '../../utils/errors';
import { createFakeSupabase, RpcError } from '../fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_COMPANY, GOLDEN_TODAY, GOLDEN_USER, type Tables } from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }) }));

type Fake = ReturnType<typeof createFakeSupabase>;
type SaveArgs = {
  p_lease: Record<string, unknown>;
  p_payment_schedule: unknown[];
  p_amortization: { period_number: number; beginning_liability: number; payment_amount: number; interest_expense: number; principal_reduction: number; ending_liability: number }[];
  p_recognition: { account_debited: string; account_credited: string; amount: number; description: string; transaction_date: string }[];
};

let fake: Fake;
let tables: Tables;
let saveImpl: (args: SaveArgs) => unknown;
const onSuccess = vi.fn();
const onClose = vi.fn();

function setup() {
  tables = buildGoldenPortfolio().tables;
  tables.lessors = [{ id: 'lessor-1', lessor_name: 'Acme Properties', lessor_type: 'corporate' }];
  saveImpl = () => 'lease-new-id';
  fake = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    rpc: { save_lease: (args) => saveImpl(args as unknown as SaveArgs) },
  });
  h.client = {
    ...fake,
    from: (table: string) => {
      const q = fake.from(table) as unknown as Record<string, unknown> & { eq: (c: string, v: unknown) => unknown };
      q.ilike = (c: string, v: unknown) => q.eq(c, v);
      return q;
    },
  };
}

const saveCalls = () => fake.calls.filter((c) => c.fn === 'save_lease').map((c) => c.args as SaveArgs);
const near = (a: number, b: number, tol = 0.02) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** The input/select that sits in the same field block as a label text. */
function field(label: string | RegExp): HTMLInputElement {
  const el = screen.getAllByText(label)[0];
  const box = (el.closest('label') ?? el).parentElement!;
  return box.querySelector('input, select, textarea') as HTMLInputElement;
}

async function renderForm() {
  const user = userEvent.setup();
  render(<LeaseForm onClose={onClose} onSuccess={onSuccess} userId={GOLDEN_USER} selectedCompanyId={GOLDEN_COMPANY} />);
  await screen.findByRole('option', { name: 'Property (PROP)' });
  await screen.findByRole('option', { name: 'Acme Properties' });
  return user;
}

async function fillValidLease(user: ReturnType<typeof userEvent.setup>, name = 'Warehouse 7') {
  await user.type(screen.getByPlaceholderText('e.g. Office Building Lease'), `  ${name}  `);
  await user.selectOptions(screen.getByDisplayValue('Select lessor...'), 'Acme Properties');
  fireEvent.change(field('Start Date'), { target: { value: '2026-01-01' } });
  fireEvent.change(field('End Date'), { target: { value: '2028-12-31' } });
  await user.selectOptions(screen.getByDisplayValue('Select asset type...'), 'at-1');
  fireEvent.change(field('Lease Component Amount (per period)'), { target: { value: '1500' } });
  fireEvent.change(field('Incremental Borrowing Rate (%)'), { target: { value: '5' } });
  fireEvent.change(field('Initial Direct Costs'), { target: { value: '800' } });
  fireEvent.change(field(/^Lease Incentives/), { target: { value: '300' } });
}

const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Create Lease/ }).closest('form')!);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
  onSuccess.mockReset();
  onClose.mockReset();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Create lease -> save_lease with generated schedule -> balanced initial recognition', () => {
  it('journey: fills the form, saves atomically, and the schedule and recognition lines tie to the lease totals', async () => {
    const user = await renderForm();
    expect(screen.getByRole('heading', { name: 'New Lease' })).toBeInTheDocument();
    await fillValidLease(user);
    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const calls = saveCalls();
    expect(calls).toHaveLength(1);
    const { p_lease: lease, p_payment_schedule: tranches, p_amortization: schedule, p_recognition: recognition } = calls[0];

    // Lease payload: identity and attribution come from the form/session, names are trimmed.
    expect(lease).toMatchObject({
      user_id: GOLDEN_USER,
      company_id: GOLDEN_COMPANY,
      fixed_asset_type_id: 'at-1',
      lease_name: 'Warehouse 7',
      lessor_name: 'Acme Properties',
      lease_start_date: '2026-01-01',
      accounting_treatment: 'recognized',
      lease_classification: 'operating',
      status: 'active',
    });
    expect(lease.id).toBeUndefined();
    expect(lease.is_complete).toBeUndefined();
    expect(tranches).toEqual([]);

    // Schedule: one row per term month, rolls forward and fully retires the opening liability.
    const liability = Number(lease.lease_liability);
    const rou = Number(lease.rou_asset);
    expect(liability).toBeGreaterThan(0);
    expect(schedule).toHaveLength(Number(lease.lease_term_months));
    expect(schedule.map((r) => r.period_number)).toEqual(schedule.map((_, i) => i + 1));
    near(schedule[0].beginning_liability, liability);
    schedule.forEach((r, i) => {
      near(r.beginning_liability - r.principal_reduction, r.ending_liability);
      near(r.payment_amount, r.interest_expense + r.principal_reduction);
      if (i > 0) near(r.beginning_liability, schedule[i - 1].ending_liability);
    });
    near(schedule[schedule.length - 1].ending_liability, 0);
    const sum = (k: 'payment_amount' | 'interest_expense' | 'principal_reduction') => schedule.reduce((s, r) => s + r[k], 0);
    near(sum('principal_reduction'), liability, 0.05);
    near(sum('payment_amount') - sum('interest_expense'), liability, 0.05);

    // Recognition: every line is a single debit/credit pair; the lines net to the ROU asset and the liability.
    expect(recognition.length).toBeGreaterThanOrEqual(3);
    for (const line of recognition) {
      expect(line.amount).toBeGreaterThan(0);
      expect(line.account_debited).not.toBe(line.account_credited);
      expect(line.transaction_date).toBe('2026-01-01');
      expect(line.description).toContain('Warehouse 7');
    }
    const net = (account: string) =>
      recognition.reduce((s, l) => s + (l.account_debited === account ? l.amount : 0) - (l.account_credited === account ? l.amount : 0), 0);
    near(net('Right-of-Use Asset'), rou);
    near(-net('Lease Liability'), liability);
    // ROU = liability + IDC - incentives (prepaid 0), and the IDC/incentive lines carry what was typed.
    near(rou, liability + 800 - 300);
    expect(recognition.find((l) => l.description.startsWith('Initial direct costs'))?.amount).toBe(800);
    expect(recognition.find((l) => l.description.startsWith('Lease incentives'))?.amount).toBe(300);

    // Everything goes through the one RPC: no direct table writes from the browser.
    expect(fake.writes).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('client validation blocks the save: asset class, date order and a zero payment', async () => {
    const user = await renderForm();
    await user.type(screen.getByPlaceholderText('e.g. Office Building Lease'), 'Depot');
    // A lessor that is not in the list yet is typed in via "+ Add new lessor...".
    await user.selectOptions(screen.getByDisplayValue('Select lessor...'), '__new__');
    await user.type(screen.getByPlaceholderText('Enter lessor name'), 'Acme');
    submit();
    expect(await screen.findByText('Select an asset class (Fixed Asset Type) before saving.')).toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue('Select asset type...'), 'at-2');
    fireEvent.change(field('Start Date'), { target: { value: '2026-05-01' } });
    fireEvent.change(field('End Date'), { target: { value: '2026-01-01' } });
    submit();
    expect(await screen.findByText('Lease end date must be after the start date.')).toBeInTheDocument();

    fireEvent.change(field('End Date'), { target: { value: '2029-04-30' } });
    submit();
    expect(await screen.findByText('Payment amount must be greater than zero for a recognized lease.')).toBeInTheDocument();

    expect(saveCalls()).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(fake.writes).toHaveLength(0);
  });

  it('a name already used by an active lease in the company is refused before saving', async () => {
    const user = await renderForm();
    const existing = String(tables.leases.find((l) => l.status === 'active')!.lease_name);
    await fillValidLease(user, existing);
    submit();
    expect(await screen.findByText(DUPLICATE_NAME_MESSAGE)).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('server failures: internal errors are not leaked and a unique-name race maps to the name message', async () => {
    saveImpl = () => { throw new RpcError('relation "lease_amortization_schedules" does not exist', '42P01'); };
    const user = await renderForm();
    await fillValidLease(user);
    submit();

    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Lease/ })).toBeEnabled());
    expect(screen.queryByText(/lease_amortization_schedules|does not exist/)).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    // Only the error log is written.
    expect(fake.writes.every((w) => w.table === 'error_logs')).toBe(true);

    saveImpl = () => { throw new RpcError('duplicate key value violates unique constraint "leases_company_name_active_key"', '23505'); };
    submit();
    expect(await screen.findByText(DUPLICATE_NAME_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/leases_company_name_active_key/)).not.toBeInTheDocument();
    expect(saveCalls()).toHaveLength(2);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

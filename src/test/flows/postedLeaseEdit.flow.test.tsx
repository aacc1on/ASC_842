/**
 * Flow: edit a lease that already has posted month-end entries (golden lease 1, posted through June 2026).
 * Financial fields are locked in the UI, the save path sends only descriptive fields with no schedule or
 * recognition rows, and the server's posted-period guard is surfaced with the Contract Modification hint.
 * A rename is allowed and saves.
 *
 * Supabase is the in-memory fake (hoisted Proxy). `get_lease_posted_through` and `save_lease` are RPC
 * handlers in this file; the posted-period rejection mirrors the server guard's wording.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LeaseForm } from '../../components/LeaseForm';
import { POSTED_LEASE_MESSAGE } from '../../utils/leaseSaveRows';
import { DUPLICATE_NAME_MESSAGE } from '../../utils/errors';
import type { Lease } from '../../types/lease';
import { createFakeSupabase, RpcError } from '../fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_COMPANY, GOLDEN_TODAY, GOLDEN_USER, leaseId, type Row, type Tables } from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({ supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }) }));

type Fake = ReturnType<typeof createFakeSupabase>;
type SaveArgs = { p_lease: Record<string, unknown>; p_payment_schedule: unknown[]; p_amortization: unknown[]; p_recognition: unknown[] };

const DESCRIPTIVE_KEYS = ['branch_id', 'id', 'lease_description', 'lease_name', 'lessor_name', 'lessor_type', 'related_party', 'related_party_name'];

let fake: Fake;
let tables: Tables;
let postedThrough: Record<string, string>;
let saveImpl: (args: SaveArgs) => unknown;
const onSuccess = vi.fn();

function setup() {
  tables = buildGoldenPortfolio().tables;
  tables.lessors = [];
  tables.lease_payment_schedules = [];
  postedThrough = { [leaseId(1)]: '2026-06-01' };
  saveImpl = (args) => args.p_lease.id;
  fake = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    rpc: {
      get_lease_posted_through: (args) => postedThrough[String(args.p_lease_id)] ?? null,
      save_lease: (args) => saveImpl(args as unknown as SaveArgs),
    },
  });
  h.client = { ...fake };
}

const leaseRow = (n: number): Row => tables.leases.find((l) => l.id === leaseId(n))!;
const saveCalls = () => fake.calls.filter((c) => c.fn === 'save_lease').map((c) => c.args as SaveArgs);

function field(label: string | RegExp): HTMLInputElement {
  const el = screen.getAllByText(label)[0];
  const box = (el.closest('label') ?? el).parentElement!;
  return box.querySelector('input, select, textarea') as HTMLInputElement;
}

async function renderEdit(n: number) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LeaseForm lease={leaseRow(n) as unknown as Lease} onClose={vi.fn()} onSuccess={onSuccess} userId={GOLDEN_USER} selectedCompanyId={GOLDEN_COMPANY} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Edit Lease' })).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Property (PROP)' });
  return user;
}

const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Update Lease/ }).closest('form')!);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
  onSuccess.mockReset();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Editing a lease with posted entries', () => {
  it('journey: lock banner, financial fields disabled, rename saves descriptive fields only', async () => {
    const original = leaseRow(1);
    const user = await renderEdit(1);

    expect(await screen.findByText('Posted through June 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contract Modification/i })).toHaveAttribute('href', '/modifications');
    expect(fake.calls.find((c) => c.fn === 'get_lease_posted_through')?.args).toEqual({ p_lease_id: leaseId(1) });

    // Financial fields are locked.
    expect(field('Start Date')).toBeDisabled();
    expect(field('End Date')).toBeDisabled();
    expect(field('Term (months)')).toBeDisabled();
    expect(field('Fixed Asset Type')).toBeDisabled();
    expect(field('Lease Component Amount (per period)')).toBeDisabled();
    expect(field('Incremental Borrowing Rate (%)')).toBeDisabled();
    expect(field('Initial Direct Costs')).toBeDisabled();
    // Descriptive fields stay editable.
    const name = screen.getByPlaceholderText('e.g. Office Building Lease');
    expect(name).toBeEnabled();
    expect(name).toHaveValue(String(original.lease_name));
    expect(screen.getByPlaceholderText('Optional description...')).toBeEnabled();

    await user.clear(name);
    await user.type(name, '  HQ Office — Tower A  ');
    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [call] = saveCalls();
    expect(Object.keys(call.p_lease).sort()).toEqual(DESCRIPTIVE_KEYS);
    expect(call.p_lease).toMatchObject({ id: leaseId(1), lease_name: 'HQ Office — Tower A', lessor_name: original.lessor_name, branch_id: original.branch_id });
    expect(call.p_payment_schedule).toEqual([]);
    expect(call.p_amortization).toEqual([]);
    expect(call.p_recognition).toEqual([]);
    expect(fake.writes).toHaveLength(0);
  });

  it('guard: a financial change forced into a locked field is not sent, and the server rejection is explained', async () => {
    await renderEdit(1);
    await screen.findByText('Posted through June 2026');

    // Force a value into the disabled payment field (as a tampered DOM would); the save still sends descriptive fields only.
    fireEvent.change(field('Lease Component Amount (per period)'), { target: { value: '999999' } });
    fireEvent.change(field('Incremental Borrowing Rate (%)'), { target: { value: '0.5' } });
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const first = saveCalls()[0].p_lease;
    expect(Object.keys(first).sort()).toEqual(DESCRIPTIVE_KEYS);
    expect(first).not.toHaveProperty('payment_amount');
    expect(first).not.toHaveProperty('incremental_borrowing_rate');

    // Server-side guard: the posted-period check rejects the save and the user is pointed at Contract Modification.
    saveImpl = () => { throw new RpcError('Lease has posted periods through 2026-06. Use Contract Modification to change it.', 'P0001'); };
    submit();
    expect(await screen.findByText(POSTED_LEASE_MESSAGE)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(fake.writes.every((w) => w.table === 'error_logs')).toBe(true);
  });

  it('a rename to a name already taken surfaces the duplicate-name message', async () => {
    saveImpl = () => { throw new RpcError('duplicate key value violates unique constraint "leases_company_name_active_key"', '23505'); };
    const user = await renderEdit(1);
    await screen.findByText('Posted through June 2026');
    const name = screen.getByPlaceholderText('e.g. Office Building Lease');
    await user.clear(name);
    await user.type(name, String(leaseRow(2).lease_name));
    submit();
    expect(await screen.findByText(DUPLICATE_NAME_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/leases_company_name_active_key/)).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('a lease with no posted periods is fully editable and re-saves its schedule', async () => {
    await renderEdit(9);
    await waitFor(() => expect(fake.calls.some((c) => c.fn === 'get_lease_posted_through')).toBe(true));
    expect(screen.queryByText(/^Posted through/)).not.toBeInTheDocument();
    expect(field('Start Date')).toBeEnabled();
    expect(field('Lease Component Amount (per period)')).toBeEnabled();
    expect(field('Fixed Asset Type')).toBeEnabled();

    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [call] = saveCalls();
    expect(call.p_lease.id).toBe(leaseId(9));
    expect(call.p_lease).toHaveProperty('payment_amount');
    expect(call.p_amortization).toHaveLength(Number(call.p_lease.lease_term_months));
    expect(call.p_recognition.length).toBeGreaterThan(0);
  });
});

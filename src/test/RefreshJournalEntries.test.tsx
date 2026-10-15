import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Lease, AmortizationSchedule } from '../types/lease';

type Row = Record<string, unknown>;

interface FakeDb {
  callerOrg: string;
  leaseOrg: Record<string, string>;
  postedThroughSeenByClient: Record<string, string | null>;
  postedThroughOnServer: Record<string, string | null>;
  journal: Row[];
  schedule: Row[];
  mods: Row[];
  rpcPayloads: Row[][];
  nextId: number;
}

const db: FakeDb = {} as FakeDb;

function monthEnd(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${firstOfMonth.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

// Mirrors public.refresh_lease_journal_entries so the client flow can be exercised end to end.
function serverRefresh(leaseId: string, entries: Row[]) {
  if (db.leaseOrg[leaseId] !== db.callerOrg) {
    return { data: null, error: { message: 'Lease not found in your organization' } };
  }
  const pt = db.postedThroughOnServer[leaseId] ?? null;
  const lockEnd = pt ? monthEnd(pt) : null;
  const mine = db.journal.filter((r) => r.lease_id === leaseId);
  const kept = lockEnd ? mine.filter((r) => String(r.entry_date) <= lockEnd) : [];
  if (kept.length > 0) {
    const bad = entries.map((e) => String(e.entry_date)).filter((d) => d <= lockEnd!).sort()[0];
    if (bad) {
      const label = (d: string) =>
        new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return {
        data: null,
        error: { message: `Journal entries for ${label(bad)} are in a posted period and cannot be replaced (posted through ${label(pt!)}).` },
      };
    }
  }
  const removed = mine.filter((r) => !lockEnd || String(r.entry_date) > lockEnd);
  db.journal = db.journal.filter((r) => !removed.includes(r));
  const key = (r: Row) => [r.lease_id, r.entry_date, r.entry_type, r.account_name, r.amortization_id ?? null, r.description].join('|');
  const existing = new Set(db.journal.map(key));
  let inserted = 0;
  for (const e of entries) {
    const row = { ...e, lease_id: leaseId, amortization_id: e.amortization_id ?? null, id: `je-${db.nextId++}` };
    if (existing.has(key(row))) continue;
    existing.add(key(row));
    db.journal.push(row);
    inserted++;
  }
  return { data: { kept_locked: kept.length, deleted: removed.length, inserted, posted_through: pt }, error: null };
}

function tableRows(table: string): Row[] {
  if (table === 'journal_entries') return db.journal;
  if (table === 'amortization_schedules') return db.schedule;
  if (table === 'contract_modifications') return db.mods;
  return [];
}

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let head = false;
  let orderCol: string | null = null;
  let window: [number, number] | null = null;
  const run = () => {
    let rows = tableRows(table).filter((r) => filters.every((f) => f(r)));
    if (orderCol) rows.sort((a, b) => String(a[orderCol!]).localeCompare(String(b[orderCol!])));
    if (window) rows = rows.slice(window[0], window[1] + 1);
    return head ? { data: null, count: rows.length, error: null } : { data: rows.map((r) => ({ ...r })), count: rows.length, error: null };
  };
  const b = {
    select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; },
    // Fixture rows without an organization belong to the signed-in user's organization.
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val || (col === 'organization_id' && r[col] === undefined)); return b; },
    not: (col: string) => { filters.push((r) => r[col] != null); return b; },
    lte: (col: string, val: string) => { filters.push((r) => String(r[col]) <= val); return b; },
    order: (col: string) => { orderCol ??= col; return b; },
    range: (from: number, to: number) => { window = [from, to]; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => query(table),
    rpc: (fn: string, args: { p_lease_id: string; p_entries?: Row[] }) => {
      if (fn === 'get_lease_posted_through') {
        return Promise.resolve({ data: db.postedThroughSeenByClient[args.p_lease_id] ?? null, error: null });
      }
      if (fn === 'refresh_lease_journal_entries') {
        db.rpcPayloads.push(args.p_entries ?? []);
        return Promise.resolve(serverRefresh(args.p_lease_id, args.p_entries ?? []));
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
    },
  },
}));

const showToast = vi.fn();
vi.mock('../components/toastContextTypes', () => ({ useToast: () => ({ showToast }) }));

import { JournalEntriesView } from '../components/JournalEntriesView';
import { refreshLeaseJournal, lockEndFor } from '../utils/journalRefresh';

const LEASE_ID = 'lease-posted';
const lease = {
  id: LEASE_ID,
  lease_name: 'Office Building',
  lease_classification: 'operating',
  lease_start_date: '2026-07-01',
  lease_end_date: '2027-06-30',
  rou_asset: 11800,
  lease_liability: 11800,
  payment_amount: 1000,
} as unknown as Lease;

function buildSchedule(leaseId: string): Row[] {
  const rows: AmortizationSchedule[] = [];
  let liability = 11800;
  for (let i = 0; i < 12; i++) {
    const date = new Date(2026, 6 + i, 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    const interest = Math.round(liability * 0.004 * 100) / 100;
    const principal = 1000 - interest;
    rows.push({
      id: `${leaseId}-am-${i + 1}`,
      lease_id: leaseId,
      period_number: i + 1,
      period_date: iso,
      beginning_liability: liability,
      payment_amount: 1000,
      interest_expense: interest,
      principal_reduction: principal,
      ending_liability: liability - principal,
      rou_asset_balance: 11800 - (i + 1) * 950,
      depreciation_expense: 950 - interest,
    });
    liability -= principal;
  }
  return rows as unknown as Row[];
}

function seedJournal(leaseId: string, dates: string[], amount: number) {
  for (const d of dates) {
    db.journal.push({ id: `seed-${leaseId}-${d}`, lease_id: leaseId, entry_date: d, entry_type: 'Operating Lease Payment',
      account_name: 'Cash', debit_amount: 0, credit_amount: amount, description: 'old', amortization_id: null });
  }
}

const LOCKED_DATES = ['2026-07-01', '2026-08-01', '2026-09-01'];
const LATER_DATES = ['2026-10-01', '2026-11-01'];

beforeEach(() => {
  showToast.mockReset();
  Object.assign(db, {
    callerOrg: 'org-a',
    leaseOrg: { [LEASE_ID]: 'org-a', 'lease-unposted': 'org-a', 'lease-other-org': 'org-b' },
    postedThroughSeenByClient: { [LEASE_ID]: '2026-09-01', 'lease-unposted': null },
    postedThroughOnServer: { [LEASE_ID]: '2026-09-01', 'lease-unposted': null },
    journal: [],
    schedule: [...buildSchedule(LEASE_ID), ...buildSchedule('lease-unposted')],
    mods: [],
    rpcPayloads: [],
    nextId: 1,
  });
});

const lockedSnapshot = () =>
  JSON.stringify(db.journal.filter((r) => r.lease_id === LEASE_ID && String(r.entry_date) <= '2026-09-30'));

async function clickRefresh() {
  const button = await screen.findByRole('button', { name: /generate \/ refresh/i });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(showToast).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: /generate \/ refresh/i })).not.toBeDisabled());
}

describe('lockEndFor', () => {
  it('returns the last day of the posted-through month', () => {
    expect(lockEndFor('2026-09-01')).toBe('2026-09-30');
    expect(lockEndFor('2024-02-01')).toBe('2024-02-29');
    expect(lockEndFor(null)).toBeNull();
  });
});

describe('Journal Generate / Refresh respects posted months', () => {
  it('on a posted lease keeps locked rows untouched and replaces only later ones', async () => {
    seedJournal(LEASE_ID, [...LOCKED_DATES, ...LATER_DATES], 999);
    const before = lockedSnapshot();

    render(<JournalEntriesView lease={lease} onClose={() => {}} />);
    await clickRefresh();

    expect(showToast).toHaveBeenCalledWith('success',
      'Posted entries through September 2026 are locked; entries after that were refreshed.');
    expect(lockedSnapshot()).toBe(before);
    const later = db.journal.filter((r) => r.lease_id === LEASE_ID && String(r.entry_date) > '2026-09-30');
    expect(later.length).toBeGreaterThan(0);
    expect(later.some((r) => r.description === 'old')).toBe(false);
    expect(db.rpcPayloads[0].every((e) => String(e.entry_date) > '2026-09-30')).toBe(true);
  });

  it('on an unposted lease replaces every entry', async () => {
    seedJournal('lease-unposted', [...LOCKED_DATES, ...LATER_DATES], 999);
    render(<JournalEntriesView lease={{ ...lease, id: 'lease-unposted' } as Lease} onClose={() => {}} />);
    await clickRefresh();

    expect(showToast).toHaveBeenCalledWith('success', 'Journal entries refreshed.');
    const rows = db.journal.filter((r) => r.lease_id === 'lease-unposted');
    expect(rows.some((r) => r.description === 'old')).toBe(false);
    expect(rows.some((r) => r.entry_type === 'Initial Recognition')).toBe(true);
  });

  it('refreshes automatically after an approved modification without touching posted months', async () => {
    seedJournal(LEASE_ID, [...LOCKED_DATES, ...LATER_DATES], 999);
    db.mods.push({ id: 'mod-1', lease_id: LEASE_ID, status: 'approved', modification_date: '2026-11-01',
      old_monthly_payment: 1000, new_monthly_payment: 1200, old_lease_term: 12, new_lease_term: 8,
      old_discount_rate: 5, new_discount_rate: 5, reason: 'Rent increase',
      old_rou_asset: 7000, new_rou_asset: 8500, old_lease_liability: 7200, new_lease_liability: 8700 });
    const before = lockedSnapshot();

    render(<JournalEntriesView lease={lease} onClose={() => {}} />);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('success',
      'Posted entries through September 2026 are locked; entries after that were refreshed.'));

    expect(lockedSnapshot()).toBe(before);
    const modRows = db.journal.filter((r) => r.lease_id === LEASE_ID && r.entry_type === 'Lease Modification');
    expect(modRows.length).toBeGreaterThan(0);
    expect(modRows.every((r) => r.entry_date === '2026-11-01')).toBe(true);
  });

  it('a double refresh leaves the same entries (idempotent), even with duplicate lines', async () => {
    seedJournal(LEASE_ID, LOCKED_DATES, 999);
    const entries = [
      { entry_date: '2026-10-01', entry_type: 'Operating Lease Payment', account_name: 'Cash', debit_amount: 0, credit_amount: 1000, description: 'Oct' },
      { entry_date: '2026-10-01', entry_type: 'Operating Lease Payment', account_name: 'Cash', debit_amount: 0, credit_amount: 1000, description: 'Oct' },
      { entry_date: '2026-11-01', entry_type: 'Operating Lease Payment', account_name: 'Cash', debit_amount: 0, credit_amount: 1000, description: 'Nov' },
    ];
    const strip = () => db.journal.filter((r) => r.lease_id === LEASE_ID)
      .map(({ id: _id, ...rest }) => JSON.stringify(rest)).sort();

    const first = await refreshLeaseJournal(LEASE_ID, entries);
    const afterFirst = strip();
    const second = await refreshLeaseJournal(LEASE_ID, entries);

    expect(first.ok && first.result).toMatchObject({ kept_locked: 3, deleted: 0, inserted: 2 });
    expect(second.ok && second.result).toMatchObject({ kept_locked: 3, deleted: 2, inserted: 2 });
    expect(strip()).toEqual(afterFirst);
  });

  it('rejects a payload entry dated in a posted month and changes nothing', async () => {
    seedJournal(LEASE_ID, [...LOCKED_DATES, ...LATER_DATES], 999);
    // The month was posted after the page loaded its status, so the page still sends it.
    db.postedThroughSeenByClient[LEASE_ID] = null;
    const before = JSON.stringify(db.journal);

    const outcome = await refreshLeaseJournal(LEASE_ID, [
      { entry_date: '2026-09-01', entry_type: 'Operating Lease Payment', account_name: 'Cash', debit_amount: 0, credit_amount: 1, description: 'x' },
    ]);

    expect(outcome).toEqual({ ok: false,
      message: 'Journal entries for September 2026 are in a posted period and cannot be replaced (posted through September 2026).' });
    expect(JSON.stringify(db.journal)).toBe(before);
  });

  it('rejects a refresh for a lease in another organization', async () => {
    db.journal.push({ id: 'other-1', lease_id: 'lease-other-org', entry_date: '2026-10-01', entry_type: 'x',
      account_name: 'Cash', debit_amount: 1, credit_amount: 0, description: 'theirs', amortization_id: null });
    const before = JSON.stringify(db.journal);

    const outcome = await refreshLeaseJournal('lease-other-org', []);

    expect(outcome).toEqual({ ok: false, message: 'Lease not found in your organization' });
    expect(JSON.stringify(db.journal)).toBe(before);
  });
});

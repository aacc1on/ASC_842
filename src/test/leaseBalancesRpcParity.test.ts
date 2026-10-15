// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateAmortizationSchedule, type AmortizationRow } from '../utils/leaseCalculations';
import { toYMD } from '../utils/formatting';

/*
 * Runs the real database balance rule (taken from the live schema snapshot) against fixture
 * leases whose schedules come from the app's own generator, and checks the RPC output against
 * values read straight from the schedule rows.
 */

const BASELINE = readFileSync(resolve(__dirname, '../../docs/schema/baseline_2026-10-12.sql'), 'utf8');

function functionFromBaseline(signature: string): string {
  const start = BASELINE.indexOf(`-- ${signature}\n`);
  if (start < 0) throw new Error(`${signature} not found in schema baseline`);
  const end = BASELINE.indexOf('$function$\n;', start);
  return BASELINE.slice(BASELINE.indexOf('\n', start) + 1, end + '$function$\n;'.length);
}

const ORG = '00000000-0000-0000-0000-00000000a001';
const OTHER_ORG = '00000000-0000-0000-0000-00000000a002';
const OWNER = '00000000-0000-0000-0000-00000000b001';
const OTHER_USER = '00000000-0000-0000-0000-00000000b002';

type Freq = 'monthly' | 'quarterly';
type Timing = 'beginning' | 'end';

interface Fixture {
  id: string;
  org: string;
  user: string;
  start: string;
  end: string;
  timing: Timing;
  rows: AmortizationRow[];
}

function schedule(term: number, payment: number, rate: number, start: string, timing: Timing, frequency: Freq): AmortizationRow[] {
  const [y, m, d] = start.split('-').map(Number);
  return generateAmortizationSchedule({
    leaseTermMonths: term,
    paymentAmount: payment,
    incrementalBorrowingRate: rate,
    initialDirectCosts: 0,
    leaseIncentives: 0,
    leaseStartDate: new Date(y, m - 1, d),
    paymentTiming: timing,
    paymentFrequency: frequency,
    residualValueGuarantee: 0,
    rvgProbableAmount: 0,
    classification: 'finance',
    prepaidLeasePayments: 0,
    purchaseOptionPrice: 0,
    purchaseOptionReasonablyCertain: false,
    amortizeOverUsefulLife: false,
    usefulLifeMonths: undefined,
  });
}

// Modified lease: original schedule for 12 months, then a remeasured schedule continues from period 13.
function modifiedSchedule(): AmortizationRow[] {
  const before = schedule(36, 1000, 5, '2026-01-01', 'end', 'monthly').slice(0, 12);
  const after = schedule(24, 1400, 6, '2027-01-01', 'end', 'monthly');
  return [...before, ...after.map((r) => ({ ...r, periodNumber: r.periodNumber + 12 }))];
}

const fixtures: Record<string, Fixture> = {
  monthlyEnd: { id: '10000000-0000-0000-0000-000000000001', org: ORG, user: OWNER, start: '2026-01-01', end: '2030-12-31', timing: 'end', rows: schedule(60, 1000, 6, '2026-01-01', 'end', 'monthly') },
  monthlyBeginning: { id: '10000000-0000-0000-0000-000000000002', org: ORG, user: OTHER_USER, start: '2026-01-01', end: '2028-12-31', timing: 'beginning', rows: schedule(36, 800, 4, '2026-01-01', 'beginning', 'monthly') },
  quarterlyEnd: { id: '10000000-0000-0000-0000-000000000003', org: ORG, user: OWNER, start: '2026-01-01', end: '2029-12-31', timing: 'end', rows: schedule(48, 3000, 5, '2026-01-01', 'end', 'quarterly') },
  quarterlyBeginning: { id: '10000000-0000-0000-0000-000000000004', org: ORG, user: OWNER, start: '2026-01-01', end: '2029-12-31', timing: 'beginning', rows: schedule(48, 3000, 5, '2026-01-01', 'beginning', 'quarterly') },
  modified: { id: '10000000-0000-0000-0000-000000000005', org: ORG, user: OWNER, start: '2026-01-01', end: '2028-12-31', timing: 'end', rows: modifiedSchedule() },
  ended: { id: '10000000-0000-0000-0000-000000000006', org: ORG, user: OWNER, start: '2020-01-01', end: '2023-12-31', timing: 'end', rows: schedule(48, 500, 5, '2020-01-01', 'end', 'monthly') },
  notStarted: { id: '10000000-0000-0000-0000-000000000007', org: ORG, user: OWNER, start: '2027-03-01', end: '2031-02-28', timing: 'end', rows: schedule(48, 700, 5, '2027-03-01', 'end', 'monthly') },
  noSchedule: { id: '10000000-0000-0000-0000-000000000008', org: ORG, user: OWNER, start: '2026-01-01', end: '2030-12-31', timing: 'end', rows: [] },
  otherOrg: { id: '10000000-0000-0000-0000-000000000009', org: OTHER_ORG, user: OWNER, start: '2026-01-01', end: '2030-12-31', timing: 'end', rows: schedule(60, 1000, 6, '2026-01-01', 'end', 'monthly') },
};

const AS_OF = '2026-10-11';
const r2 = (n: number) => Math.round(n * 100) / 100;

let db: PGlite;

interface RpcRow { lease_id: string; rou: string; liability: string; status: string; current_portion: string; opening_rou: string }

async function rpc(asOf: string, ids: string[] | null, user = OWNER, dataAccess = true): Promise<Map<string, RpcRow>> {
  await db.query(`select set_config('test.uid', $1, false), set_config('test.access', $2, false)`, [user, dataAccess ? 'on' : 'off']);
  const res = await db.query<RpcRow>('select * from public.get_lease_balances_as_of($1::date, $2::uuid[])', [asOf, ids]);
  return new Map(res.rows.map((r) => [r.lease_id, r]));
}

const asNumbers = (r: RpcRow | undefined) => r && ({
  rou: Number(r.rou), liability: Number(r.liability), status: r.status, current: Number(r.current_portion), opening: Number(r.opening_rou),
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE SCHEMA internal;
    CREATE FUNCTION internal.current_org_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${ORG}'::uuid $$;
    CREATE FUNCTION internal.has_data_access() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.access', true) = 'on' $$;
    CREATE TABLE public.leases (
      id uuid PRIMARY KEY, organization_id uuid, user_id uuid,
      lease_start_date date, lease_end_date date, payment_timing text
    );
    CREATE TABLE public.amortization_schedules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lease_id uuid REFERENCES public.leases(id),
      period_number int, period_date date, beginning_liability numeric, payment_amount numeric,
      interest_expense numeric, principal_reduction numeric, ending_liability numeric,
      rou_asset_balance numeric, depreciation_expense numeric
    );
  `);
  await db.exec(functionFromBaseline('internal.lease_balance_as_of(p_lease_id uuid, p_as_of date)'));
  await db.exec(functionFromBaseline('public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[])'));

  for (const f of Object.values(fixtures)) {
    await db.query('insert into public.leases values ($1, $2, $3, $4, $5, $6)', [f.id, f.org, f.user, f.start, f.end, f.timing]);
    for (const r of f.rows) {
      await db.query(
        `insert into public.amortization_schedules (lease_id, period_number, period_date, beginning_liability, payment_amount,
          interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [f.id, r.periodNumber, toYMD(r.periodDate), r.beginningLiability, r.paymentAmount, r.interestExpense,
          r.principalReduction, r.endingLiability, r.rouAssetBalance, r.depreciationExpense],
      );
    }
  }
}, 60000);

afterAll(async () => {
  await db?.close();
});

// AS_OF (2026-10-11) is inside period 10; periods 1-9 are complete.
const CUR = 9;
const DONE = 8;

describe('get_lease_balances_as_of parity with schedule rows', () => {
  it('monthly, end timing: liability = beginning of the current period, ROU = last completed period', async () => {
    const { rows, id } = fixtures.monthlyEnd;
    const b = asNumbers((await rpc(AS_OF, [id])).get(id));
    expect(b).toMatchObject({ status: 'active', liability: r2(rows[CUR].beginningLiability), rou: r2(rows[DONE].rouAssetBalance) });
    expect(b?.current).toBeCloseTo(rows[CUR].beginningLiability - rows[CUR + 12].beginningLiability, 2);
    expect(b?.opening).toBe(r2(rows[0].rouAssetBalance + rows[0].depreciationExpense));
  });

  it('monthly, beginning timing: the current period payment is already deducted', async () => {
    const { rows, id } = fixtures.monthlyBeginning;
    const b = asNumbers((await rpc(AS_OF, [id])).get(id));
    expect(b).toMatchObject({
      status: 'active',
      liability: r2(rows[CUR].beginningLiability - rows[CUR].paymentAmount),
      rou: r2(rows[DONE].rouAssetBalance),
    });
    const later = rows[CUR + 12].beginningLiability - rows[CUR + 12].paymentAmount;
    expect(b?.current).toBeCloseTo(rows[CUR].beginningLiability - rows[CUR].paymentAmount - later, 2);
  });

  it('quarterly, end and beginning timing follow the same row lookups', async () => {
    const res = await rpc(AS_OF, [fixtures.quarterlyEnd.id, fixtures.quarterlyBeginning.id]);
    const qe = fixtures.quarterlyEnd.rows;
    const qb = fixtures.quarterlyBeginning.rows;
    expect(asNumbers(res.get(fixtures.quarterlyEnd.id))).toMatchObject({ status: 'active', liability: r2(qe[CUR].beginningLiability), rou: r2(qe[DONE].rouAssetBalance) });
    expect(asNumbers(res.get(fixtures.quarterlyBeginning.id))).toMatchObject({
      status: 'active', liability: r2(qb[CUR].beginningLiability - qb[CUR].paymentAmount), rou: r2(qb[DONE].rouAssetBalance),
    });
  });

  it('modified lease: balances after the remeasurement come from the new schedule rows', async () => {
    const { rows, id } = fixtures.modified;
    const asOf = '2027-03-15';
    const b = asNumbers((await rpc(asOf, [id])).get(id));
    expect(b).toMatchObject({ status: 'active', liability: r2(rows[14].beginningLiability), rou: r2(rows[13].rouAssetBalance) });
    expect(b?.current).toBeCloseTo(rows[14].beginningLiability - rows[26].beginningLiability, 2);
  });

  it('ended, not started and no schedule return zero with the right status', async () => {
    const res = await rpc(AS_OF, [fixtures.ended.id, fixtures.notStarted.id, fixtures.noSchedule.id]);
    expect(asNumbers(res.get(fixtures.ended.id))).toMatchObject({ status: 'ended', rou: 0, liability: 0, current: 0 });
    expect(asNumbers(res.get(fixtures.notStarted.id))).toMatchObject({ status: 'not_started', rou: 0, liability: 0, current: 0 });
    expect(asNumbers(res.get(fixtures.noSchedule.id))).toMatchObject({ status: 'no_schedule', rou: 0, liability: 0, opening: 0 });
  });

  it('last schedule period completed -> ended', async () => {
    const { id } = fixtures.monthlyEnd;
    expect((await rpc('2030-12-31', [id])).get(id)?.status).toBe('ended');
  });

  it('current portion never exceeds the liability in the final year', async () => {
    const { id } = fixtures.monthlyBeginning;
    const b = asNumbers((await rpc('2028-06-15', [id])).get(id));
    expect(b?.current).toBe(b?.liability);
  });

  it('only returns leases of the caller organization', async () => {
    const res = await rpc(AS_OF, null);
    expect(res.has(fixtures.otherOrg.id)).toBe(false);
    expect(res.size).toBe(8);
  });

  it('users without data access only see their own leases', async () => {
    const res = await rpc(AS_OF, null, OTHER_USER, false);
    expect([...res.keys()]).toEqual([fixtures.monthlyBeginning.id]);
  });

  it('returns nothing without a signed-in user', async () => {
    const res = await rpc(AS_OF, null, '', true);
    expect(res.size).toBe(0);
  });
});

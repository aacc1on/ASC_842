import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import type { createFakeSupabase } from '../fixtures/fakeSupabase';

vi.hoisted(() => { process.env.TZ = 'UTC'; });

const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeSupabase> }));

vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (holder.db as unknown as Record<string | symbol, unknown>)[k] }),
}));

import { createFakeSupabase as makeDb } from '../fixtures/fakeSupabase';
import { buildGoldenPortfolio, GOLDEN_TODAY, GOLDEN_USER, leaseId } from '../fixtures/goldenPortfolio';
import type { Lease } from '../../types/lease';
import {
  applyCancellation,
  applyImpairment,
  applyModification,
  computeCancellation,
  computeImpairment,
  computeModification,
  getCarryingAmountsAtDate,
  hasPostedMonthEnd,
  type ComputeModificationOptions,
  type ScheduleRow,
} from '../../utils/leaseModification';

let tables: ReturnType<typeof buildGoldenPortfolio>['tables'];

function lease(n: number): Lease {
  return tables.leases.find((l) => l.id === leaseId(n)) as unknown as Lease;
}

function opts(l: Lease, extra: Partial<ComputeModificationOptions> = {}): ComputeModificationOptions {
  return {
    classification: l.lease_classification,
    purchaseOptionPrice: 0,
    purchaseOptionReasonablyCertain: false,
    rvgProbableAmount: 0,
    amortizeOverUsefulLife: false,
    usefulLifeMonths: undefined,
    ...extra,
  };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  tables = buildGoldenPortfolio().tables;
  tables.contract_modifications.push({ id: 'mod-g', lease_id: leaseId(1), accounting_posted: false });
  tables.contract_cancellations = [{ id: 'can-g', lease_id: leaseId(4), derecognition_posted: false }];
  tables.lease_impairments = [{ id: 'imp-g', lease_id: leaseId(2), posted: false }];
  tables.audit_log = [];
  holder.db = makeDb(tables, { userId: GOLDEN_USER });
});

describe('golden: lease modification calculators', () => {
  it('carrying amounts and posted-month-end checks', async () => {
    expect({
      finance: await getCarryingAmountsAtDate(leaseId(1), '2026-08-01'),
      operating: await getCarryingAmountsAtDate(leaseId(4), '2026-08-01'),
      postedFromJuly: await hasPostedMonthEnd(leaseId(1), '2026-07-01'),
      postedEver: await hasPostedMonthEnd(leaseId(1)),
    }).toMatchSnapshot();
    await expect(getCarryingAmountsAtDate('missing', '2026-08-01')).rejects.toThrowErrorMatchingSnapshot();
  });

  it('computeModification: increases, decreases with gain, useful-life extension', async () => {
    const fin = lease(1);
    const op = lease(4);
    const cFin = await getCarryingAmountsAtDate(fin.id, '2026-08-01');
    const cOp = await getCarryingAmountsAtDate(op.id, '2026-08-01');
    const summary = (r: ReturnType<typeof computeModification>) => ({ ...r, remainingSchedule: r.remainingSchedule.length, first: r.remainingSchedule[0], last: r.remainingSchedule[r.remainingSchedule.length - 1] });
    expect({
      financeIncrease: summary(computeModification(fin, cFin, 2400, 36, 7, opts(fin))),
      financeDecreaseGain: summary(computeModification(fin, cFin, 100, 6, 6, opts(fin))),
      financeUsefulLife: summary(computeModification(fin, cFin, 2000, 17, 6, opts(fin, { amortizeOverUsefulLife: true, usefulLifeMonths: 30 }))),
      financePurchaseOption: summary(computeModification(fin, cFin, 2000, 17, 6, opts(fin, { purchaseOptionPrice: 5000, purchaseOptionReasonablyCertain: true, rvgProbableAmount: 1000 }))),
      operatingExtension: summary(computeModification(op, cOp, 1200, 24, 5.5, opts(op))),
      operatingReclassToFinance: summary(computeModification(op, cOp, 1200, 24, 5.5, opts(op, { classification: 'finance' }))),
    }).toMatchSnapshot();
  });

  it('computeCancellation: gain, loss, no payments', () => {
    expect({
      gain: computeCancellation(20000, 25000, 1000, 500),
      loss: computeCancellation(25000, 20000, 1500, 0),
      zero: computeCancellation(10000, 10000, 0, 0),
    }).toMatchSnapshot();
  });

  it('computeImpairment: valid case and rejected inputs', async () => {
    const carrying = await getCarryingAmountsAtDate(leaseId(2), '2026-08-01');
    const rows = (tables.amortization_schedules as unknown as ScheduleRow[])
      .filter((r) => (r as unknown as { lease_id: string }).lease_id === leaseId(2) && r.period_number > carrying.periodsCompleted)
      .sort((a, b) => a.period_number - b.period_number);
    const res = computeImpairment(carrying, 3000, rows);
    expect({ ...res, remainingSchedule: res.remainingSchedule.length, first: res.remainingSchedule[0], last: res.remainingSchedule[res.remainingSchedule.length - 1] }).toMatchSnapshot();
    expect(() => computeImpairment(carrying, carrying.rouAsset + 1, rows)).toThrowErrorMatchingSnapshot();
    expect(() => computeImpairment(carrying, 0, rows)).toThrowErrorMatchingSnapshot();
    expect(() => computeImpairment(carrying, 100, [])).toThrowErrorMatchingSnapshot();
  });
});

describe('golden: lease modification database writes', () => {
  it('applyModification remeasures and rebuilds the schedule', async () => {
    const res = await applyModification('mod-g', lease(1), '2026-08-01', 2400, 36, 7, GOLDEN_USER);
    expect({ result: { ...res, remainingSchedule: res.remainingSchedule.length }, writes: holder.db.writes }).toMatchSnapshot();
  });

  it('applyModification as a separate contract only marks the modification', async () => {
    await applyModification('mod-g', lease(1), '2026-08-01', 2400, 36, 7, GOLDEN_USER, true, 50000, 60);
    expect(holder.db.writes).toMatchSnapshot();
  });

  it('applyModification refuses when month-end is already posted', async () => {
    await expect(applyModification('mod-g', lease(1), '2026-05-01', 2400, 36, 7, GOLDEN_USER)).rejects.toThrowErrorMatchingSnapshot();
  });

  it('applyCancellation for a recognised lease and a short-term lease', async () => {
    const recognised = await applyCancellation('can-g', lease(4), '2026-08-31', 1500, 500, GOLDEN_USER);
    const recognisedWrites = [...holder.db.writes];
    tables.contract_cancellations.push({ id: 'can-st', lease_id: leaseId(11), derecognition_posted: false });
    holder.db.writes.length = 0;
    const shortTerm = await applyCancellation('can-st', lease(11), '2026-08-31', 300, 0, GOLDEN_USER);
    expect({ recognised, recognisedWrites, shortTerm, shortTermWrites: holder.db.writes }).toMatchSnapshot();
  });

  it('applyImpairment writes the impairment and audit trail', async () => {
    const res = await applyImpairment('imp-g', lease(2), '2026-08-01', 3000, 'Store closure', GOLDEN_USER);
    expect({ result: { ...res, remainingSchedule: res.remainingSchedule.length }, writes: holder.db.writes }).toMatchSnapshot();
    await expect(applyImpairment('imp-g', lease(2), '2026-08-01', 3000, 'again', GOLDEN_USER)).rejects.toThrowErrorMatchingSnapshot();
  });
});

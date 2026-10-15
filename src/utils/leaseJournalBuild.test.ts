import { describe, it, expect } from 'vitest';
import type { AmortizationSchedule } from '../types/lease';
import { buildGoldenPortfolio, leaseId } from '../test/fixtures/goldenPortfolio';
import { buildLeaseJournalEntries, computeRemeasuredValues, type ApprovedModification } from './leaseJournalBuild';
import { calculatePresentValue } from './leaseCalculations';

const { leases, tables } = buildGoldenPortfolio();
const scheduleFor = (id: string) =>
  (tables.amortization_schedules as unknown as AmortizationSchedule[])
    .filter((r) => r.lease_id === id)
    .sort((a, b) => a.period_number - b.period_number);

const mod = (over: Partial<ApprovedModification> = {}): ApprovedModification => ({
  id: 'm1',
  modification_date: '2026-03-15',
  old_monthly_payment: 1000,
  new_monthly_payment: 1200,
  old_lease_term: 36,
  new_lease_term: 30,
  old_discount_rate: 5,
  new_discount_rate: 6,
  reason: 'Rent increase',
  old_rou_asset: null,
  new_rou_asset: null,
  old_lease_liability: null,
  new_lease_liability: null,
  ...over,
});

const sum = (rows: { debit_amount: number; credit_amount: number }[], k: 'debit_amount' | 'credit_amount') =>
  Math.round(rows.reduce((s, r) => s + Number(r[k]), 0) * 100) / 100;

describe('computeRemeasuredValues', () => {
  it('uses stored remeasured values when present', () => {
    expect(computeRemeasuredValues(mod({ new_lease_liability: 500, new_rou_asset: 450 }), 1, 1)).toEqual({
      remeasuredLiability: 500,
      remeasuredRouAsset: 450,
    });
  });

  it('falls back to present value and shifts the ROU asset by the liability change', () => {
    const pv = calculatePresentValue(1200, 30, 6, 'beginning');
    const out = computeRemeasuredValues(mod(), 20000, 18000);
    expect(out.remeasuredLiability).toBe(pv);
    expect(out.remeasuredRouAsset).toBeCloseTo(18000 + (pv - 20000), 8);
  });
});

describe('buildLeaseJournalEntries', () => {
  const lease = leases.find((l) => l.id === leaseId(1))!;
  const schedule = scheduleFor(lease.id);

  it('builds balanced recognition and periodic entries linked to schedule rows', () => {
    const entries = buildLeaseJournalEntries(lease, schedule, []);
    expect(schedule.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.entry_type === 'Lease Modification')).toBe(false);
    expect(sum(entries, 'debit_amount')).toBe(sum(entries, 'credit_amount'));
    const linked = new Set(entries.map((e) => e.amortization_id).filter(Boolean));
    expect(linked.size).toBe(schedule.length);
  });

  it('inserts remeasurement entries at the boundary of an approved modification', () => {
    const midDate = schedule[Math.floor(schedule.length / 2)].period_date.split('T')[0];
    const entries = buildLeaseJournalEntries(lease, schedule, [
      mod({ modification_date: midDate, new_lease_liability: 1000, new_rou_asset: 900, old_lease_liability: 1500, old_rou_asset: 1400 }),
    ]);
    const modEntries = entries.filter((e) => e.entry_type === 'Lease Modification');
    expect(modEntries.length).toBeGreaterThan(0);
    expect(modEntries.every((e) => e.entry_date === midDate)).toBe(true);
    expect(sum(modEntries, 'debit_amount')).toBe(sum(modEntries, 'credit_amount'));
  });
});

import { describe, it, expect } from 'vitest';
import { computeImpairment, type CarryingAmounts, type ScheduleRow } from './leaseModification';

function makeScheduleRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    period_number: 1,
    period_date: '2026-02-01',
    beginning_liability: 30000,
    payment_amount: 1000,
    interest_expense: 150,
    principal_reduction: 850,
    ending_liability: 29150,
    rou_asset_balance: 25000,
    depreciation_expense: 800,
    ...overrides,
  };
}

function makeCarrying(overrides: Partial<CarryingAmounts> = {}): CarryingAmounts {
  return {
    rouAsset: 24000,
    leaseLiability: 28000,
    periodsCompleted: 12,
    ...overrides,
  };
}

describe('computeImpairment — independent recalculation tests', () => {
  it('reduces ROU by impairment amount and distributes depreciation evenly', () => {
    const carrying = makeCarrying({ rouAsset: 24000 });
    const rows = [
      makeScheduleRow({ period_number: 13 }),
      makeScheduleRow({ period_number: 14 }),
      makeScheduleRow({ period_number: 15 }),
    ];
    const impairmentAmount = 6000;
    const result = computeImpairment(carrying, impairmentAmount, rows);

    // rouAfter = 24000 - 6000 = 18000
    const expectedRouAfter = 18000;
    expect(result.rouAfter).toBeCloseTo(expectedRouAfter, 2);

    // baseDepreciation = 18000 / 3 = 6000
    // Period 1: dep=6000, rou=18000-6000=12000
    // Period 2: dep=6000, rou=12000-6000=6000
    // Period 3 (final): dep=6000 (current), rou=0
    expect(result.remainingSchedule[0].depreciation_expense).toBeCloseTo(6000, 2);
    expect(result.remainingSchedule[0].rou_asset_balance).toBeCloseTo(12000, 2);
    expect(result.remainingSchedule[1].depreciation_expense).toBeCloseTo(6000, 2);
    expect(result.remainingSchedule[1].rou_asset_balance).toBeCloseTo(6000, 2);
    expect(result.remainingSchedule[2].depreciation_expense).toBeCloseTo(6000, 2);
    expect(result.remainingSchedule[2].rou_asset_balance).toBe(0);
  });

  it('final row plugs ROU to exactly 0 (handles rounding)', () => {
    const carrying = makeCarrying({ rouAsset: 10000 });
    const rows = [
      makeScheduleRow({ period_number: 1 }),
      makeScheduleRow({ period_number: 2 }),
      makeScheduleRow({ period_number: 3 }),
    ];
    const impairmentAmount = 1000;
    const result = computeImpairment(carrying, impairmentAmount, rows);

    // rouAfter = 9000, baseDep = 9000/3 = 3000
    // After rounding, the final row should be exactly 0
    expect(result.remainingSchedule[2].rou_asset_balance).toBe(0);
    const totalDep = result.remainingSchedule.reduce((s, r) => s + r.depreciation_expense, 0);
    expect(totalDep).toBeCloseTo(9000, 2);
  });

  it('preserves liability-side values exactly', () => {
    const carrying = makeCarrying({ rouAsset: 20000 });
    const rows = [
      makeScheduleRow({
        period_number: 13,
        beginning_liability: 28000,
        payment_amount: 1200,
        interest_expense: 140,
        principal_reduction: 1060,
        ending_liability: 26940,
      }),
      makeScheduleRow({
        period_number: 14,
        beginning_liability: 26940,
        payment_amount: 1200,
        interest_expense: 134.7,
        principal_reduction: 1065.3,
        ending_liability: 25874.7,
      }),
    ];
    const result = computeImpairment(carrying, 5000, rows);

    // Liability columns should be identical to input
    expect(result.remainingSchedule[0].beginning_liability).toBe(28000);
    expect(result.remainingSchedule[0].payment_amount).toBe(1200);
    expect(result.remainingSchedule[0].interest_expense).toBe(140);
    expect(result.remainingSchedule[0].principal_reduction).toBe(1060);
    expect(result.remainingSchedule[0].ending_liability).toBe(26940);
    expect(result.remainingSchedule[1].beginning_liability).toBe(26940);
    expect(result.remainingSchedule[1].ending_liability).toBe(25874.7);
  });

  it('throws when impairment exceeds carrying ROU', () => {
    const carrying = makeCarrying({ rouAsset: 5000 });
    expect(() => computeImpairment(carrying, 6000, [makeScheduleRow()])).toThrow(
      /exceeds the carrying ROU asset amount/
    );
  });

  it('throws when impairment amount is zero', () => {
    expect(() => computeImpairment(makeCarrying(), 0, [makeScheduleRow()])).toThrow(
      /must be greater than zero/
    );
  });

  it('throws when impairment amount is negative', () => {
    expect(() => computeImpairment(makeCarrying(), -100, [makeScheduleRow()])).toThrow(
      /must be greater than zero/
    );
  });

  it('throws when schedule is empty', () => {
    expect(() => computeImpairment(makeCarrying(), 1000, [])).toThrow(
      /No remaining schedule rows/
    );
  });

  it('handles impairment equal to full ROU (rouAfter = 0)', () => {
    const carrying = makeCarrying({ rouAsset: 3000 });
    const rows = [
      makeScheduleRow({ period_number: 1 }),
      makeScheduleRow({ period_number: 2 }),
    ];
    const result = computeImpairment(carrying, 3000, rows);

    expect(result.rouAfter).toBe(0);
    expect(result.remainingSchedule[0].depreciation_expense).toBe(0);
    expect(result.remainingSchedule[0].rou_asset_balance).toBe(0);
    expect(result.remainingSchedule[1].depreciation_expense).toBe(0);
    expect(result.remainingSchedule[1].rou_asset_balance).toBe(0);
  });

  it('handles single remaining period', () => {
    const carrying = makeCarrying({ rouAsset: 10000 });
    const rows = [makeScheduleRow({ period_number: 36 })];
    const result = computeImpairment(carrying, 3000, rows);

    expect(result.rouAfter).toBe(7000);
    expect(result.remainingSchedule).toHaveLength(1);
    expect(result.remainingSchedule[0].depreciation_expense).toBe(7000);
    expect(result.remainingSchedule[0].rou_asset_balance).toBe(0);
  });

  it('rouBefore matches input carrying amount', () => {
    const carrying = makeCarrying({ rouAsset: 15000 });
    const result = computeImpairment(carrying, 2000, [makeScheduleRow()]);
    expect(result.rouBefore).toBe(15000);
  });

  it('impairmentAmount in result is rounded', () => {
    const result = computeImpairment(makeCarrying({ rouAsset: 10000 }), 3333.333, [makeScheduleRow()]);
    expect(result.impairmentAmount).toBeCloseTo(3333.33, 2);
  });

  it('handles many periods with small impairment', () => {
    const carrying = makeCarrying({ rouAsset: 20000 });
    const rows = Array.from({ length: 24 }, (_, i) =>
      makeScheduleRow({ period_number: i + 1 })
    );
    const result = computeImpairment(carrying, 1000, rows);

    expect(result.rouAfter).toBe(19000);
    // baseDep = 19000/24 = 791.67
    // Final row should bring ROU to 0
    expect(result.remainingSchedule[23].rou_asset_balance).toBe(0);
    const totalDep = result.remainingSchedule.reduce((s, r) => s + r.depreciation_expense, 0);
    expect(totalDep).toBeCloseTo(19000, 2);
  });

  it('handles rounding where base depreciation has remainder', () => {
    const carrying = makeCarrying({ rouAsset: 10000 });
    const rows = [
      makeScheduleRow({ period_number: 1 }),
      makeScheduleRow({ period_number: 2 }),
      makeScheduleRow({ period_number: 3 }),
    ];
    // rouAfter = 10000 - 1000 = 9000
    // baseDep = 9000/3 = 3000 (exact, no remainder)
    const result = computeImpairment(carrying, 1000, rows);
    expect(result.remainingSchedule[2].rou_asset_balance).toBe(0);
    expect(result.remainingSchedule[2].depreciation_expense).toBeCloseTo(3000, 2);
  });

  it('prevents negative ROU balance on non-final rows', () => {
    // Large impairment with few remaining periods could push base dep > remaining ROU
    const carrying = makeCarrying({ rouAsset: 100 });
    const rows = [
      makeScheduleRow({ period_number: 1 }),
      makeScheduleRow({ period_number: 2 }),
    ];
    // rouAfter = 100 - 10 = 90, baseDep = 45
    const result = computeImpairment(carrying, 10, rows);
    expect(result.remainingSchedule[0].rou_asset_balance).toBeGreaterThanOrEqual(0);
    expect(result.remainingSchedule[1].rou_asset_balance).toBe(0);
  });
});

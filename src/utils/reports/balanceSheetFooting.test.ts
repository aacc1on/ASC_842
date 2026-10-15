import { describe, expect, it } from 'vitest';
import { rouRollforward } from './balanceSheet';
import { footBalanceSheet, footBalancesByType } from './balanceSheetFooting';
import type { BalanceSheetData, LeaseBalancesByType } from './statementTypes';

const bs = (over: Partial<BalanceSheetData['assets']>, liab: Partial<BalanceSheetData['liabilities']>): BalanceSheetData => ({
  assets: {
    currentRouAsset: 954804.16,
    accumulatedDepreciation: 360271.06,
    accumulatedAmortizationFinance: 340335.07,
    accumulatedAmortizationOperating: 19935.99,
    impairment: 0,
    netRouAsset: 594533.1,
    breakdown: { grossRou: [], accDepreciation: [], impairment: [] },
    ...over,
  },
  liabilities: {
    currentPortion: 88917.51,
    longTermPortion: 575149.61,
    totalLiability: 664067.12,
    leaseIncentiveLiability: 0,
    residualValueGuarantee: 0,
    breakdown: { current: [], longTerm: [] },
    ...liab,
  },
  equity: { retainedEarnings: 0 },
  asOfDate: new Date(2026, 8, 30),
});

describe('rouRollforward', () => {
  it('derives accumulated amortization from commencement ROU and net', () => {
    expect(rouRollforward(13127.48, 0, 0, 3280.91)).toEqual({ gross: 13127.48, impairment: 0, accumulated: 9846.57 });
  });

  it('adds remeasurement deltas to gross and keeps impairments separate', () => {
    const r = rouRollforward(1000, 250.5, 100, 700.25);
    expect(r.gross).toBe(1250.5);
    expect(r.impairment).toBe(100);
    expect(r.accumulated).toBe(450.25);
  });
});

describe('footBalanceSheet', () => {
  it('foots ROU and liabilities in whole dollars', () => {
    const f = footBalanceSheet(bs({}, {}));
    expect(f.netRou).toBe(594533);
    expect(f.grossRou).toBe(954804);
    expect(f.grossRou - f.accumulatedTotal - f.impairment).toBe(f.netRou);
    expect(f.accumulatedFinance + f.accumulatedOperating).toBe(f.accumulatedTotal);
    expect(f.accumulatedOperating).toBe(19936);
    expect(f.accumulatedFinance).toBe(340335);
    expect(f.totalLiability).toBe(664067);
    expect(f.longTerm).toBe(575149);
    expect(f.current).toBe(88918);
    expect(f.current + f.longTerm).toBe(f.totalLiability);
  });

  it('includes impairments in the ROU footing', () => {
    const f = footBalanceSheet(bs({ currentRouAsset: 1000.6, impairment: 100.4, accumulatedAmortizationOperating: 199.9, accumulatedAmortizationFinance: 0, netRouAsset: 700.3 }, {}));
    expect(f.grossRou - f.accumulatedTotal - f.impairment).toBe(f.netRou);
    expect(f.impairment).toBe(100);
  });
});

describe('footBalancesByType', () => {
  const byType: LeaseBalancesByType = {
    operatingGrossRou: 86531.91,
    financeGrossRou: 868272.25,
    operatingAccumulatedAmortization: 19935.99,
    financeAccumulatedAmortization: 340335.07,
    operatingImpairment: 0,
    financeImpairment: 0,
    operatingRouAsset: 66595.92,
    financeRouAsset: 527937.18,
    operatingLiabilityCurrent: 11040.99,
    operatingLiabilityNoncurrent: 55554.93,
    financeLiabilityCurrent: 77876.52,
    financeLiabilityNoncurrent: 519594.68,
    totalRouAsset: 594533.1,
    totalLiabilityCurrent: 88917.51,
    totalLiabilityNoncurrent: 575149.61,
    totalLiability: 664067.12,
  };

  it('produces the MS Consulting Sep 30 2026 figures', () => {
    const t = footBalancesByType(byType);
    expect(t.gross).toEqual({ operating: 86532, finance: 868272, total: 954804 });
    expect(t.accumulated).toEqual({ operating: 19936, finance: 340335, total: 360271 });
    expect(t.rou).toEqual({ operating: 66596, finance: 527937, total: 594533 });
    expect(t.current).toEqual({ operating: 11041, finance: 77877, total: 88918 });
    expect(t.noncurrent).toEqual({ operating: 55555, finance: 519594, total: 575149 });
    expect(t.liability).toEqual({ operating: 66596, finance: 597471, total: 664067 });
  });

  it('foots every row and column and agrees with the balance sheet', () => {
    const t = footBalancesByType(byType);
    const f = footBalanceSheet(bs({}, {}));
    for (const row of [t.gross, t.accumulated, t.impairment, t.rou, t.current, t.noncurrent, t.liability]) {
      expect(row.operating + row.finance).toBe(row.total);
    }
    for (const col of ['operating', 'finance', 'total'] as const) {
      expect(t.gross[col] - t.accumulated[col] - t.impairment[col]).toBe(t.rou[col]);
      expect(t.current[col] + t.noncurrent[col]).toBe(t.liability[col]);
    }
    expect(t.rou.total).toBe(f.netRou);
    expect(t.gross.total).toBe(f.grossRou);
    expect(t.accumulated.operating).toBe(f.accumulatedOperating);
    expect(t.liability.total).toBe(f.totalLiability);
    expect(t.current.total).toBe(f.current);
  });
});

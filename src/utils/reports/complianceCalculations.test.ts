import { describe, it, expect } from 'vitest';
import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType } from '../financialReports';
import {
  toIso, presetRange, resolveReportDates, filterActiveLeases, eligibleLeases, monthsBetween, remainingMonths,
  presentValueAtInception, buildClassificationRows, splitByClassification, weightedAvg, computeWeightedMetrics,
  classTotals, sumPayments, EMPTY_MATURITY, maturityBucketLabels, type Reassessment,
} from './complianceCalculations';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'l1',
  lease_name: 'Lease 1',
  status: 'active',
  lease_start_date: '2026-01-01',
  lease_end_date: '2026-12-31',
  lease_term_months: 12,
  payment_amount: 100,
  payment_frequency: 'monthly',
  payment_timing: 'beginning',
  lease_classification: 'operating',
  accounting_treatment: 'standard',
  incremental_borrowing_rate: 0,
  ...over,
} as unknown as Lease);

describe('toIso / presetRange / resolveReportDates', () => {
  it('formats a local date as YYYY-MM-DD with zero padding', () => {
    expect(toIso(new Date(2026, 2, 5, 15, 30))).toBe('2026-03-05');
  });

  it('builds every preset range relative to now', () => {
    const now = new Date(2026, 5, 15);
    const iso = (p: Parameters<typeof presetRange>[0]) => presetRange(p, now)!.map(toIso);
    expect(iso('ytd')).toEqual(['2026-01-01', '2026-06-15']);
    expect(iso('q1')).toEqual(['2026-01-01', '2026-03-31']);
    expect(iso('q2')).toEqual(['2026-04-01', '2026-06-30']);
    expect(iso('q3')).toEqual(['2026-07-01', '2026-09-30']);
    expect(iso('q4')).toEqual(['2026-10-01', '2026-12-31']);
    expect(iso('fy')).toEqual(['2026-01-01', '2026-12-31']);
    expect(iso('lastFy')).toEqual(['2025-01-01', '2025-12-31']);
    expect(presetRange('bogus' as never, now)).toBeNull();
  });

  it('uses the later of start/end as the as-of date', () => {
    const a = resolveReportDates('2026-01-01', '2026-06-30');
    expect(a.today).toBe(a.periodEndDate);
    const b = resolveReportDates('2026-06-30', '2026-01-01');
    expect(b.today).toBe(b.periodStartDate);
    expect(a.periodStartDate.getHours()).toBe(0);
  });
});

describe('filterActiveLeases / eligibleLeases', () => {
  it('keeps only active leases overlapping the period', () => {
    const leases = [
      lease({ id: 'a' }),
      lease({ id: 'b', status: 'terminated' as Lease['status'] }),
      lease({ id: 'c', lease_start_date: '2027-01-01', lease_end_date: '2027-12-31' }),
      lease({ id: 'd', lease_start_date: '2024-01-01', lease_end_date: '2025-12-31' }),
    ];
    expect(filterActiveLeases(leases, '2026-01-01', '2026-06-30').map((l) => l.id)).toEqual(['a']);
  });

  it('drops short-term exempt and terminated leases from eligible list', () => {
    const leases = [lease({ id: 'a' }), lease({ id: 'b', accounting_treatment: 'short_term_exemption' } as Partial<Lease>), lease({ id: 'c', status: 'terminated' as Lease['status'] })];
    expect(eligibleLeases(leases).map((l) => l.id)).toEqual(['a']);
  });
});

describe('monthsBetween / remainingMonths', () => {
  it('counts whole months and never goes negative', () => {
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 15))).toBe(3);
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 14))).toBe(2);
    expect(monthsBetween(new Date(2026, 5, 1), new Date(2026, 0, 1))).toBe(0);
  });

  it('measures remaining months from the as-of date to lease end', () => {
    expect(remainingMonths(lease({ lease_end_date: '2027-12-31' }), new Date(2026, 11, 31))).toBe(12);
    expect(remainingMonths(lease({ lease_end_date: '2025-12-31' }), new Date(2026, 11, 31))).toBe(0);
  });
});

describe('presentValueAtInception', () => {
  it('returns 0 for a non-positive term or negative payment', () => {
    expect(presentValueAtInception(lease({ lease_term_months: 0 }))).toBe(0);
    expect(presentValueAtInception(lease({ payment_amount: -1 }))).toBe(0);
  });

  it('equals the undiscounted sum at a zero rate and is discounted at a positive rate', () => {
    expect(presentValueAtInception(lease())).toBeCloseTo(1200, 2);
    const discounted = presentValueAtInception(lease({ incremental_borrowing_rate: 6 }));
    expect(discounted).toBeLessThan(1200);
    expect(discounted).toBeGreaterThan(1150);
  });

  it('falls back to monthly for unknown payment frequencies', () => {
    expect(presentValueAtInception(lease({ payment_frequency: 'odd' as Lease['payment_frequency'] }))).toBeCloseTo(1200, 2);
  });
});

describe('buildClassificationRows', () => {
  it('computes PV with prepaid payments and ratios from lease data', () => {
    const [row] = buildClassificationRows([lease({ prepaid_lease_payments: 50, asset_market_value: 2000, asset_economic_life_months: 60 } as Partial<Lease>)], new Map());
    expect(row.pv).toBe(1250);
    expect(row.fv).toBe(2000);
    expect(row.termRatio).toBeCloseTo(1 / 60, 10);
    expect(row.pvRatio).toBeCloseTo(0.625, 10);
    expect(row.purchaseRatio).toBeNull();
    expect(row.reassessedOn).toBeNull();
    expect(row.classification).toBe('operating');
    expect(row.mismatch).toBe(false);
  });

  it('uses N/A ratios when life/fair value are missing and flags mismatches', () => {
    const [row] = buildClassificationRows([lease({ transfer_ownership: true } as Partial<Lease>)], new Map());
    expect(row.termRatio).toBeNull();
    expect(row.pvRatio).toBeNull();
    expect(row.classification).toBe('finance');
    expect(row.mismatch).toBe(true);
  });

  it('re-tests on modified terms when a reassessment exists', () => {
    const r: Reassessment = { lease_id: 'l1', modification_date: '2026-03-01', reassessed_classification: 'finance', new_lease_liability: 1900, new_lease_term: 24, fair_value_at_modification: 2000 };
    const [row] = buildClassificationRows([lease({ asset_market_value: 5000, asset_economic_life_months: 24, purchase_option: true, purchase_option_price: 500 } as Partial<Lease>)], new Map([['l1', r]]));
    expect(row.pv).toBe(1900);
    expect(row.fv).toBe(2000);
    expect(row.termRatio).toBeCloseTo(2 / 24, 10);
    expect(row.purchaseRatio).toBe(0.25);
    expect(row.reassessedOn).toBe('2026-03-01');
    expect(row.tests.substantiallyAllValue).toBe(true);
  });
});

describe('split / weighted averages / totals', () => {
  const fin = lease({ id: 'f', lease_classification: 'finance', incremental_borrowing_rate: 4, lease_end_date: '2028-12-31', payment_amount: 300 });
  const op1 = lease({ id: 'o1', incremental_borrowing_rate: 5, lease_end_date: '2027-12-31' });
  const op2 = lease({ id: 'o2', incremental_borrowing_rate: 8, lease_end_date: '2029-12-31', payment_amount: 50 });
  const st = lease({ id: 's', accounting_treatment: 'short_term_exemption' } as Partial<Lease>);

  it('splits by classification excluding short-term exempt leases', () => {
    const { finance, operating } = splitByClassification([fin, op1, op2, st]);
    expect(finance.map((l) => l.id)).toEqual(['f']);
    expect(operating.map((l) => l.id)).toEqual(['o1', 'o2']);
  });

  it('weightedAvg returns 0 with no weight', () => {
    expect(weightedAvg([op1], () => 0, () => 10)).toBe(0);
    expect(weightedAvg([op1, op2], (l) => (l.id === 'o1' ? 1 : 3), (l) => (l.id === 'o1' ? 2 : 6))).toBe(5);
  });

  it('weights term and rate by remaining scheduled liability', () => {
    const m = computeWeightedMetrics([fin], [op1, op2], new Map([['f', 1000], ['o1', 100], ['o2', 300]]), new Date(2026, 11, 31));
    expect(m.watFinance).toBe(2);
    expect(m.watOperating).toBe((100 * 1 + 300 * 3) / 400);
    expect(m.wadrFinance).toBe(4);
    expect(m.wadrOperating).toBe((100 * 5 + 300 * 8) / 400);
    expect(computeWeightedMetrics([fin], [op1], new Map(), new Date())).toEqual({ watFinance: 0, watOperating: 0, wadrFinance: 0, wadrOperating: 0 });
  });

  it('sums payments and class totals with round2', () => {
    expect(sumPayments([fin, op2])).toBe(350);
    const b = { financeRouAsset: 10, operatingRouAsset: 20, financeLiabilityCurrent: 1.111, financeLiabilityNoncurrent: 2.222, operatingLiabilityCurrent: 3.005, operatingLiabilityNoncurrent: 4 } as LeaseBalancesByType;
    expect(classTotals(b, 'finance')).toEqual({ rou: 10, liab: 3.33 });
    expect(classTotals(b, 'operating')).toEqual({ rou: 20, liab: 7.01 });
    expect(classTotals(null, 'finance')).toEqual({ rou: 0, liab: 0 });
  });
});

describe('maturity helpers', () => {
  it('has an all-zero empty maturity', () => {
    expect(Object.values(EMPTY_MATURITY).every((v) => v === 0)).toBe(true);
  });

  it('labels five yearly buckets from the as-of date', () => {
    expect(maturityBucketLabels(new Date(2026, 8, 30))).toEqual([
      'Year 1 (to Sep 30, 2027)',
      'Year 2 (to Sep 30, 2028)',
      'Year 3 (to Sep 30, 2029)',
      'Year 4 (to Sep 30, 2030)',
      'Year 5 (to Sep 30, 2031)',
    ]);
  });
});

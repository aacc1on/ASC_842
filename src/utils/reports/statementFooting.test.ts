import { describe, expect, it } from 'vitest';
import { breakdownTable, CF_BREAKDOWN_ROWS, PL_BREAKDOWN_ROWS } from './breakdownRows';
import { footCashFlow, footMaturity, footProfitLoss } from './statementFooting';
import type { CashFlowData, ProfitLossData } from './statementTypes';

const pl = (dep: number, lease: number, st: number, interest: number, gain = 0, loss = 0): ProfitLossData => ({
  periodStart: new Date(2026, 0, 1),
  periodEnd: new Date(2026, 11, 31),
  operatingExpenses: {
    depreciationExpense: dep, leaseExpense: lease, shortTermLeaseCost: st, initialDirectCostsAmortized: 0,
    total: dep + lease + st,
    breakdown: { depreciation: [], leaseExpense: [], shortTermLeaseCost: [], idc: [] },
  },
  financingCosts: { interestExpense: interest, breakdown: { interest: [] } },
  gainLossOnTermination: { gain, loss, net: gain - loss, breakdown: [] },
  totalExpenses: dep + lease + st + interest,
  netIncome: gain - loss - (dep + lease + st + interest),
});

const cf = (interest: number, lease: number, st: number, term: number, principal: number): CashFlowData => ({
  periodStart: new Date(2026, 0, 1),
  periodEnd: new Date(2026, 11, 31),
  operatingActivities: {
    interestPaid: interest, leasePayments: lease, shortTermLeasePayments: st, terminationCashPaid: term,
    total: -(interest + lease + st + term),
    breakdown: { interest: [], leasePayments: [], shortTermLeasePayments: [], terminationCash: [] },
  },
  financingActivities: {
    principalPayments: principal, initialDirectCostsPaid: 0, residualValueGuaranteePaid: 0, total: -principal,
    breakdown: { principal: [], idc: [], rvg: [] },
  },
  netCashFlow: -(interest + lease + st + term + principal),
});

describe('footProfitLoss', () => {
  it('foots operating, total expenses and net income from displayed lines', () => {
    const f = footProfitLoss(pl(100.5, 200.5, 0.4, 50.5, 10.4, 3.6));
    expect(f.depreciation + f.leaseExpense + f.shortTermLeaseCost + f.idc).toBe(f.operatingTotal);
    expect(f.operatingTotal + f.interest).toBe(f.totalExpenses);
    expect(f.gain - f.loss).toBe(f.netGainLoss);
    expect(f.netGainLoss - f.totalExpenses).toBe(f.netIncome);
    expect(f.operatingTotal).toBe(302);
  });
});

describe('footCashFlow', () => {
  it('foots operating, financing and net change', () => {
    const f = footCashFlow(cf(10.5, 20.5, 1.4, 0, 99.5));
    expect(-(f.interestPaid + f.leasePayments + f.shortTermLeasePayments + f.terminationCashPaid)).toBe(f.operatingTotal);
    expect(-(f.principalPayments + f.idcPaid + f.rvgPaid)).toBe(f.financingTotal);
    expect(f.operatingTotal + f.financingTotal).toBe(f.netCashFlow);
  });

  it('shows zero totals without a negative sign', () => {
    expect(Object.is(footCashFlow(cf(0, 0, 0, 0, 0)).operatingTotal, -0)).toBe(false);
  });
});

describe('footMaturity', () => {
  it('foots buckets to undiscounted total and reconciles to the liability', () => {
    const m = footMaturity({ y1: 100.5, y2: 100.5, y3: 0.4, y4: 0, y5: 0, thereafter: 0.4, totalUndiscounted: 201.8, liabilitySum: 180.6, imputedInterest: 21.2 });
    expect([...m.years, m.thereafter].reduce((s, v) => s + v, 0)).toBe(m.totalUndiscounted);
    expect(m.totalUndiscounted - m.imputedInterest).toBe(m.liability);
    expect(m.liability).toBe(181);
  });
});

describe('breakdownTable', () => {
  const slices = [{ pl: pl(0.5, 0.5, 0, 0.5), cf: cf(0.5, 0.5, 0, 0, 0.5) }, { pl: pl(0.5, 0.5, 0, 0.5), cf: cf(0.5, 0.5, 0, 0, 0.5) }];

  it('foots every subtotal row and the Total column in whole dollars', () => {
    const t = breakdownTable(PL_BREAKDOWN_ROWS, slices, 'whole');
    const row = (label: string) => t.find((r) => r.label === label)!;
    expect(row('Total Operating Expenses').values).toEqual([2, 2]);
    expect(row('Total Lease Expenses').values).toEqual([3, 3]);
    for (const r of t) expect(r.values.reduce((s, v) => s + v, 0)).toBe(r.total);
    expect(row('Total Operating Expenses').total).toBe(row('Depreciation Expense').total + row('Lease Expense (Operating)').total);
  });

  it('foots cash flow subtotals and net change', () => {
    const t = breakdownTable(CF_BREAKDOWN_ROWS, slices, 'whole');
    const row = (label: string) => t.find((r) => r.label === label)!;
    expect(row('Net Change in Cash').total).toBe(row('Net Operating Cash Flow').total + row('Net Financing Cash Flow').total);
  });

  it('keeps cents precision by default', () => {
    const t = breakdownTable(PL_BREAKDOWN_ROWS, [{ pl: pl(0.1, 0.2, 0, 0) }]);
    expect(t.find((r) => r.label === 'Total Operating Expenses')!.values).toEqual([0.3]);
  });
});

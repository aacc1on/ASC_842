import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Lease } from '../types/lease';
import { buildPaymentStream, generateAmortizationSchedule, round2, type AmortizationRow, type PaymentFrequency } from '../utils/leaseCalculations';
import { generateMonthEndTransactions, paymentDateForPeriod, type StoredScheduleMap } from '../utils/monthEndTransactions';
import { computeImpairment, computeCancellation, type ScheduleRow } from '../utils/leaseModification';
import { qualifiesForShortTermExemption, computeShortTermLeaseCost } from '../utils/shortTermLease';
import { generateProfitLossAndCashFlow } from '../utils/financialReports';
import { leaseLifecycle } from '../utils/leaseLifecycle';
import { toYMD } from '../utils/formatting';
import { journalEntryStatus, totalsByStatus } from '../utils/journalEntries';

let scheduleRowsForMock: unknown[] = [];

vi.mock('../lib/supabase', async () => {
  const { chainableMock } = await import('../utils/testSupabaseMock');
  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'amortization_schedules') return chainableMock();
        const chain: Record<string, unknown> = {};
        for (const k of ['select', 'eq', 'in', 'gte', 'lte', 'not', 'order']) chain[k] = () => chain;
        chain.range = () => Promise.resolve({ data: scheduleRowsForMock, error: null });
        return chain;
      },
    },
  };
});

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'edge-lease-0001',
    lease_name: 'Edge Lease',
    status: 'active',
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-12-31',
    lease_term_months: 12,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    payment_timing: 'beginning',
    incremental_borrowing_rate: 6,
    lease_classification: 'finance',
    accounting_treatment: 'recognized',
    component_policy: 'combined',
    nonlease_component_amount: 0,
    ...overrides,
  } as Lease;
}

function scheduleFor(lease: Lease): AmortizationRow[] {
  const [y, m, d] = lease.lease_start_date.split('-').map(Number);
  return generateAmortizationSchedule({
    leaseTermMonths: lease.lease_term_months,
    paymentAmount: lease.payment_amount,
    incrementalBorrowingRate: lease.incremental_borrowing_rate,
    initialDirectCosts: 0,
    leaseIncentives: 0,
    leaseStartDate: new Date(y, m - 1, d),
    paymentTiming: lease.payment_timing,
    paymentFrequency: lease.payment_frequency as PaymentFrequency,
    classification: lease.lease_classification,
  });
}

function toStoredRows(rows: AmortizationRow[]): ScheduleRow[] {
  return rows.map((r) => ({
    period_number: r.periodNumber,
    period_date: toYMD(r.periodDate),
    beginning_liability: r.beginningLiability,
    payment_amount: r.paymentAmount,
    interest_expense: r.interestExpense,
    principal_reduction: r.principalReduction,
    ending_liability: r.endingLiability,
    rou_asset_balance: r.rouAssetBalance,
    depreciation_expense: r.depreciationExpense,
  }));
}

function storedMap(lease: Lease): StoredScheduleMap {
  return new Map([[lease.id, toStoredRows(scheduleFor(lease))]]);
}

function sum(rows: AmortizationRow[], key: keyof AmortizationRow): number {
  return round2(rows.reduce((s, r) => s + (r[key] as number), 0));
}

describe('quarterly payments', () => {
  const lease = makeLease({ payment_frequency: 'quarterly', payment_amount: 3000 });
  const rows = scheduleFor(lease);

  it('pays in advance in months 1, 4, 7 and 10 only', () => {
    const paid = rows.map((r, i) => (r.paymentAmount > 0 ? i + 1 : 0)).filter(Boolean);
    expect(paid).toEqual([1, 4, 7, 10]);
    expect(sum(rows, 'paymentAmount')).toBe(12000);
  });

  it('closes the liability to zero and interest equals payments minus initial liability', () => {
    expect(rows[rows.length - 1].endingLiability).toBe(0);
    expect(sum(rows, 'interestExpense')).toBeCloseTo(12000 - rows[0].beginningLiability, 1);
  });

  it('posts a payment entry only in payment months', () => {
    const map = storedMap(lease);
    const payments = (period: string) => generateMonthEndTransactions([lease], period, map).filter((t) => t.transaction_type === 'payment');
    expect(payments('2026-04')).toHaveLength(1);
    expect(payments('2026-05')).toHaveLength(0);
  });
});

describe('annual payments', () => {
  const lease = makeLease({ payment_frequency: 'annually', payment_amount: 12000, lease_term_months: 36, lease_end_date: '2028-12-31' });
  const rows = scheduleFor(lease);

  it('pays once a year in advance', () => {
    const paid = rows.map((r, i) => (r.paymentAmount > 0 ? i + 1 : 0)).filter(Boolean);
    expect(paid).toEqual([1, 13, 25]);
    expect(buildPaymentStream(36, 12000, undefined, 'annually', 'beginning').reduce((s, p) => s + p, 0)).toBe(36000);
  });

  it('closes the liability and fully depreciates the ROU asset', () => {
    expect(rows[35].endingLiability).toBe(0);
    expect(rows[35].rouAssetBalance).toBe(0);
    expect(sum(rows, 'depreciationExpense')).toBeCloseTo(rows[0].beginningLiability, 1);
  });
});

describe('commencement on the 31st', () => {
  const lease = makeLease({ lease_start_date: '2026-01-31', lease_end_date: '2027-01-30' });

  it('pays on the last day of shorter months', () => {
    expect(paymentDateForPeriod(lease, 2026, 2)).toBe('2026-02-28');
    expect(paymentDateForPeriod(lease, 2026, 3)).toBe('2026-03-31');
    expect(paymentDateForPeriod(lease, 2026, 4)).toBe('2026-04-30');
  });

  it('dates payments on the payment date and expenses at period end', () => {
    const txns = generateMonthEndTransactions([lease], '2026-04', storedMap(lease));
    const byType = new Map(txns.map((t) => [t.transaction_type, t.transaction_date]));
    expect(byType.get('payment')).toBe('2026-04-30');
    expect(byType.get('interest')).toBe('2026-04-30');
    expect(byType.get('amortization')).toBe('2026-04-30');
  });

  it('uses an explicit payment day when one is set', () => {
    expect(paymentDateForPeriod({ ...lease, payment_day_of_month: 5 }, 2026, 2)).toBe('2026-02-05');
  });
});

describe('commencement on Feb 29', () => {
  const lease = makeLease({ lease_start_date: '2024-02-29', lease_end_date: '2025-02-28', lease_term_months: 12 });

  it('pays on Feb 28 in non-leap years and Feb 29 in leap years', () => {
    expect(paymentDateForPeriod(lease, 2024, 3)).toBe('2024-03-29');
    expect(paymentDateForPeriod(lease, 2025, 2)).toBe('2025-02-28');
    expect(paymentDateForPeriod(lease, 2028, 2)).toBe('2028-02-29');
  });

  it('builds 12 monthly periods starting February 2024', () => {
    const rows = scheduleFor(lease);
    expect(rows).toHaveLength(12);
    expect(toYMD(rows[0].periodDate)).toBe('2024-02-01');
    expect(toYMD(rows[11].periodDate)).toBe('2025-01-01');
    expect(rows[11].endingLiability).toBe(0);
  });

  it('dates an in-arrears payment at month end', () => {
    expect(paymentDateForPeriod({ ...lease, payment_timing: 'end' }, 2024, 4)).toBe('2024-04-30');
  });

  it('is active through its end date and ended the day after', () => {
    expect(leaseLifecycle(lease, '2025-02-28')).toBe('active');
    expect(leaseLifecycle(lease, '2025-03-01')).toBe('ended');
    expect(leaseLifecycle(lease, '2024-02-28')).toBe('not_started');
  });
});

describe('ROU asset impairment', () => {
  const lease = makeLease({ lease_term_months: 24, lease_end_date: '2027-12-31' });
  const stored = toStoredRows(scheduleFor(lease));
  const remaining = stored.slice(6);
  const carrying = { rouAsset: stored[5].rou_asset_balance, leaseLiability: stored[5].ending_liability, periodsCompleted: 6 };

  it('reduces the ROU asset, leaves the liability untouched and depreciates the rest to zero', () => {
    const result = computeImpairment(carrying, 2000, remaining);
    expect(result.rouAfter).toBe(round2(carrying.rouAsset - 2000));
    expect(result.remainingSchedule.map((r) => r.ending_liability)).toEqual(remaining.map((r) => r.ending_liability));
    expect(result.remainingSchedule.map((r) => r.interest_expense)).toEqual(remaining.map((r) => r.interest_expense));
    const dep = round2(result.remainingSchedule.reduce((s, r) => s + r.depreciation_expense, 0));
    expect(dep).toBe(result.rouAfter);
    expect(result.remainingSchedule[result.remainingSchedule.length - 1].rou_asset_balance).toBe(0);
  });

  it('rejects an impairment larger than the carrying ROU asset or not positive', () => {
    expect(() => computeImpairment(carrying, carrying.rouAsset + 1, remaining)).toThrow();
    expect(() => computeImpairment(carrying, 0, remaining)).toThrow();
  });
});

describe('early termination', () => {
  it('records a gain when the liability exceeds ROU plus penalty', () => {
    expect(computeCancellation(10000, 10500, 200, 0)).toEqual({ carryingRouAsset: 10000, carryingLiability: 10500, gainLoss: 300, isGain: true });
  });

  it('records a loss when ROU plus penalty and final payment exceed the liability', () => {
    const r = computeCancellation(10000, 10200, 500, 100);
    expect(r.isGain).toBe(false);
    expect(r.gainLoss).toBe(400);
  });

  it('stops month-end postings once the lease is terminated', () => {
    const lease = makeLease({ status: 'terminated' });
    expect(generateMonthEndTransactions([lease], '2026-06', storedMap(lease))).toHaveLength(0);
  });
});

describe('short-term leases', () => {
  it('does not qualify above 12 months or with a reasonably certain purchase option', () => {
    const base = { companyId: 'c1', fixedAssetTypeId: null, leaseStartDate: '2026-01-01', shortTermElections: [] };
    expect(qualifiesForShortTermExemption({ ...base, leaseTermMonths: 13, purchaseOptionReasonablyCertain: false } as never).applied).toBe(false);
    expect(qualifiesForShortTermExemption({ ...base, leaseTermMonths: 12, purchaseOptionReasonablyCertain: true } as never).applied).toBe(false);
  });

  it('expenses straight-line and posts nothing after the term', () => {
    const lease = makeLease({ accounting_treatment: 'short_term_exemption', lease_classification: 'operating', lease_term_months: 6, lease_end_date: '2026-06-30', payment_amount: 900 });
    expect(computeShortTermLeaseCost(5400, 6)).toBe(900);
    const june = generateMonthEndTransactions([lease], '2026-06', new Map());
    expect(june.filter((t) => t.transaction_type === 'short_term_lease_expense')[0].debit_amount).toBe(900);
    expect(june.every((t) => t.transaction_date === '2026-06-30')).toBe(true);
    expect(generateMonthEndTransactions([lease], '2026-07', new Map())).toHaveLength(0);
  });
});

describe('journal entry posting status', () => {
  const posted = new Set(['2026-01', '2026-02']);
  const entries = [
    { entry_date: '2025-12-15', entry_type: 'Initial Recognition', debit_amount: 500, credit_amount: 500 },
    { entry_date: '2026-01-01', entry_type: 'Finance Lease - Interest', debit_amount: 10, credit_amount: 10 },
    { entry_date: '2026-02-01', entry_type: 'Finance Lease - Payment', debit_amount: 100, credit_amount: 100 },
    { entry_date: '2026-03-01', entry_type: 'Finance Lease - Interest', debit_amount: 9, credit_amount: 9 },
  ];

  it('marks closed months and recorded events as posted, the rest as projected', () => {
    expect(entries.map((e) => journalEntryStatus(e, posted))).toEqual(['posted', 'posted', 'posted', 'projected']);
  });

  it('keeps separate totals that add up to the overall total', () => {
    const t = totalsByStatus(entries, posted);
    expect(t.posted).toEqual({ count: 3, debits: 610, credits: 610 });
    expect(t.projected).toEqual({ count: 1, debits: 9, credits: 9 });
  });
});

describe('P&L breakdown sums to the period total', () => {
  const lease = makeLease({ id: 'pl-lease', lease_start_date: '2026-01-15', lease_end_date: '2027-01-14' });
  beforeEach(() => {
    scheduleRowsForMock = toStoredRows(scheduleFor(lease)).map((r) => ({
      ...r,
      lease_id: lease.id,
      period_date: r.period_date.slice(0, 8) + '15',
      short_term_lease_cost: 0,
    }));
  });

  const plFor = async (start: Date, end: Date) => {
    const { pl } = await generateProfitLossAndCashFlow([lease], start, end);
    return { dep: pl.operatingExpenses.depreciationExpense, int: pl.financingCosts.interestExpense };
  };

  it('Year total equals the sum of its 12 months', async () => {
    const year = await plFor(new Date(2026, 0, 1), new Date(2026, 11, 31));
    let dep = 0, int = 0;
    for (let m = 0; m < 12; m++) {
      const r = await plFor(new Date(2026, m, 1), new Date(2026, m + 1, 0));
      dep += r.dep; int += r.int;
    }
    expect(year.dep).toBeGreaterThan(0);
    expect(round2(dep)).toBeCloseTo(year.dep, 2);
    expect(round2(int)).toBeCloseTo(year.int, 2);
  });

  it('Month total equals the sum of its weeks', async () => {
    const month = await plFor(new Date(2026, 2, 1), new Date(2026, 2, 31));
    const weeks: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]];
    let dep = 0;
    for (const [a, b] of weeks) dep += (await plFor(new Date(2026, 2, a), new Date(2026, 2, b))).dep;
    expect(month.dep).toBeGreaterThan(0);
    expect(round2(dep)).toBeCloseTo(month.dep, 2);
  });
});

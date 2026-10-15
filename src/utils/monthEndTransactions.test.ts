import { describe, it, expect } from 'vitest';
import {
  latestPostedBlocker,
  generateMonthEndTransactions,
  validateMonthEndPeriod,
  periodHasEnded,
  summarizeMonthEndTransactions,
  getPreviousPeriod,
  getNextPeriod,
  formatPeriodDisplay,
  getCurrentPeriod,
  type StoredScheduleMap,
  type StoredScheduleRow,
} from './monthEndTransactions';
import { generateAmortizationSchedule } from './leaseCalculations';
import type { Lease } from '../types/lease';

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2028-12-31',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'end',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function buildStoredSchedules(leases: Lease[]): StoredScheduleMap {
  const map: StoredScheduleMap = new Map();
  for (const lease of leases) {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: lease.lease_term_months,
      paymentAmount: lease.payment_amount,
      incrementalBorrowingRate: lease.incremental_borrowing_rate,
      initialDirectCosts: lease.initial_direct_costs ?? 0,
      leaseIncentives: lease.lease_incentives ?? 0,
      leaseStartDate: new Date(lease.lease_start_date),
      paymentTiming: (lease.payment_timing as 'beginning' | 'end') ?? 'end',
      paymentFrequency: 'monthly',
      residualValueGuarantee: lease.residual_value_guarantee ?? 0,
      rvgProbableAmount: 0,
      classification: lease.lease_classification as 'operating' | 'finance',
    });
    const rows: StoredScheduleRow[] = schedule.map((r) => ({
      period_number: r.periodNumber,
      period_date: `${r.periodDate.getFullYear()}-${String(r.periodDate.getMonth() + 1).padStart(2, '0')}-${String(r.periodDate.getDate()).padStart(2, '0')}`,
      beginning_liability: r.beginningLiability,
      payment_amount: r.paymentAmount,
      interest_expense: r.interestExpense,
      principal_reduction: r.principalReduction,
      ending_liability: r.endingLiability,
      rou_asset_balance: r.rouAssetBalance,
      depreciation_expense: r.depreciationExpense,
    }));
    map.set(lease.id, rows);
  }
  return map;
}

describe('generateMonthEndTransactions', () => {
  it('operating lease: generates 3 transactions (2 operating_lease_expense + 1 payment)', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    expect(txns).toHaveLength(3);
    const types = txns.map(t => t.transaction_type);
    expect(types.filter(t => t === 'operating_lease_expense')).toHaveLength(2);
    expect(types.filter(t => t === 'payment')).toHaveLength(1);
  });

  it('finance lease: generates 3 transactions (interest, payment, amortization)', () => {
    const lease = makeLease({ lease_classification: 'finance' });
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    expect(txns).toHaveLength(3);
    const types = txns.map(t => t.transaction_type);
    expect(types).toContain('interest');
    expect(types).toContain('payment');
    expect(types).toContain('amortization');
  });

  it('every transaction has equal debits and credits', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    for (const t of txns) {
      expect(t.debit_amount).toBe(t.credit_amount);
    }
  });

  it('operating lease: does NOT record Depreciation Expense or Interest Expense', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    const debited = txns.map(t => t.account_debited);
    const credited = txns.map(t => t.account_credited);
    expect(debited).not.toContain('Depreciation Expense');
    expect(debited).not.toContain('Interest Expense');
    expect(credited).not.toContain('Accumulated Depreciation - ROU Asset');
  });

  it('operating lease: records Operating Lease Expense', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    const debited = txns.map(t => t.account_debited);
    expect(debited).toContain('Operating Lease Expense');
  });

  it('skips inactive leases', () => {
    const lease = makeLease({ status: 'cancelled' });
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    expect(txns).toHaveLength(0);
  });

  it('skips periods before lease start', () => {
    const lease = makeLease({ lease_start_date: '2026-03-01' });
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    expect(txns).toHaveLength(0);
  });

  it('skips periods after lease end', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2029-06', stored);
    expect(txns).toHaveLength(0);
  });

  it('handles multiple leases in the same period', () => {
    const leases = [
      makeLease({ id: 'l1', lease_name: 'Lease 1' }),
      makeLease({ id: 'l2', lease_name: 'Lease 2' }),
    ];
    const stored = buildStoredSchedules(leases);
    const txns = generateMonthEndTransactions(leases, '2026-01', stored);
    expect(txns).toHaveLength(6);
  });
});

describe('validateMonthEndPeriod', () => {
  it('valid format YYYY-MM', () => {
    expect(validateMonthEndPeriod('2026-01')).toEqual({ valid: true });
  });

  it('rejects bad format', () => {
    expect(validateMonthEndPeriod('2026-13').valid).toBe(false);
    expect(validateMonthEndPeriod('invalid').valid).toBe(false);
    expect(validateMonthEndPeriod('2026').valid).toBe(false);
  });

  it('rejects out-of-range year', () => {
    expect(validateMonthEndPeriod('1999-01').valid).toBe(false);
    expect(validateMonthEndPeriod('2101-01').valid).toBe(false);
  });
});

describe('periodHasEnded', () => {
  it('is false during the month and on its last day', () => {
    expect(periodHasEnded('2026-10', new Date(2026, 9, 11))).toBe(false);
    expect(periodHasEnded('2026-10', new Date(2026, 9, 31))).toBe(false);
  });
  it('is true from the first day of the next month', () => {
    expect(periodHasEnded('2026-10', new Date(2026, 10, 1))).toBe(true);
    expect(periodHasEnded('2026-09', new Date(2026, 9, 11))).toBe(true);
  });
});

describe('summarizeMonthEndTransactions', () => {
  it('total debits equal total credits', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    const summary = summarizeMonthEndTransactions(txns);
    expect(summary.totalDebits).toBeCloseTo(summary.totalCredits, 2);
  });

  it('counts unique leases and transactions correctly', () => {
    const leases = [
      makeLease({ id: 'l1' }),
      makeLease({ id: 'l2' }),
    ];
    const stored = buildStoredSchedules(leases);
    const txns = generateMonthEndTransactions(leases, '2026-01', stored);
    const summary = summarizeMonthEndTransactions(txns);
    expect(summary.totalLeases).toBe(2);
    expect(summary.totalTransactions).toBe(6);
  });

  it('operating lease: totalOperatingLeaseCost > 0, totalInterest = 0, totalDepreciation = 0', () => {
    const lease = makeLease();
    const stored = buildStoredSchedules([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    const summary = summarizeMonthEndTransactions(txns);
    expect(summary.totalOperatingLeaseCost).toBeGreaterThan(0);
    expect(summary.totalInterest).toBe(0);
    expect(summary.totalDepreciation).toBe(0);
    expect(summary.totalPayments).toBe(1000);
  });
});

describe('period helpers', () => {
  it('getPreviousPeriod', () => {
    expect(getPreviousPeriod('2026-03')).toBe('2026-02');
    expect(getPreviousPeriod('2026-01')).toBe('2025-12');
  });

  it('getNextPeriod', () => {
    expect(getNextPeriod('2026-01')).toBe('2026-02');
    expect(getNextPeriod('2026-12')).toBe('2027-01');
  });

  it('formatPeriodDisplay', () => {
    expect(formatPeriodDisplay('2026-01')).toContain('January');
    expect(formatPeriodDisplay('2026-01')).toContain('2026');
  });

  it('getCurrentPeriod returns YYYY-MM', () => {
    const p = getCurrentPeriod();
    expect(p).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('latestPostedBlocker (month-end delete/reopen rule)', () => {
  const docs = [
    { period: '2026-08', status: 'posted' },
    { period: '2026-09', status: 'posted' },
  ];
  it('allows the latest posted month', () => {
    expect(latestPostedBlocker(docs, docs[1])).toBeNull();
  });
  it('refuses an earlier posted month and names the latest', () => {
    expect(latestPostedBlocker(docs, docs[0])).toBe('Remove later months first (latest posted: September 2026)');
  });
  it('ignores drafts', () => {
    expect(latestPostedBlocker(docs, { period: '2026-07', status: 'draft' })).toBeNull();
  });
});

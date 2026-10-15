import { describe, it, expect } from 'vitest';
import { generateMonthEndTransactions, generateMonthEndTransactionsWithSkips, type StoredScheduleMap, type StoredScheduleRow } from './monthEndTransactions';
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
    lease_end_date: '2026-12-31',
    lease_term_months: 12,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    discount_rate: 6,
    lease_classification: 'finance',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 11618.93,
    lease_liability: 11618.93,
    status: 'active',
    payment_timing: 'end',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 15000,
    asset_market_value: 15000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Lease;
}

/**
 * Builds a stored schedule map matching what the lease form would write,
 * using the shared toYMD helper (via generateAmortizationSchedule).
 */
function buildStoredSchedule(lease: Lease): StoredScheduleMap {
  const schedule = generateAmortizationSchedule({
    leaseTermMonths: lease.lease_term_months,
    paymentAmount: lease.payment_amount,
    incrementalBorrowingRate: lease.discount_rate ?? lease.incremental_borrowing_rate,
    initialDirectCosts: lease.initial_direct_costs,
    leaseIncentives: lease.lease_incentives,
    leaseStartDate: new Date(lease.lease_start_date),
    paymentTiming: lease.payment_timing || 'beginning',
    paymentFrequency: 'monthly',
    residualValueGuarantee: lease.residual_value_guarantee || 0,
    rvgProbableAmount: lease.rvg_probable_amount || 0,
    classification: lease.lease_classification,
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

  const map: StoredScheduleMap = new Map();
  map.set(lease.id, rows);
  return map;
}

describe('QA-006: Month-end matches stored rows by period_number, not date', () => {
  it('posts exactly the schedule interest, depreciation and payment for month 1', () => {
    const lease = makeLease();
    const storedSchedules = buildStoredSchedule(lease);
    const txns = generateMonthEndTransactions([lease], '2026-01', storedSchedules);

    const stored = storedSchedules.get(lease.id)!;
    const row1 = stored[0];

    const interestTxn = txns.find(t => t.transaction_type === 'interest');
    const paymentTxn = txns.find(t => t.transaction_type === 'payment');
    const depTxn = txns.find(t => t.transaction_type === 'amortization');

    expect(interestTxn).toBeDefined();
    expect(paymentTxn).toBeDefined();
    expect(depTxn).toBeDefined();

    expect(interestTxn!.debit_amount).toBeCloseTo(row1.interest_expense, 2);
    expect(paymentTxn!.debit_amount).toBeCloseTo(row1.payment_amount, 2);
    expect(depTxn!.debit_amount).toBeCloseTo(row1.depreciation_expense, 2);
  });

  it('posts month 2 correctly (not month 3)', () => {
    const lease = makeLease();
    const storedSchedules = buildStoredSchedule(lease);
    const txns = generateMonthEndTransactions([lease], '2026-02', storedSchedules);

    const stored = storedSchedules.get(lease.id)!;
    const row2 = stored[1]; // period_number = 2

    const interestTxn = txns.find(t => t.transaction_type === 'interest');
    expect(interestTxn).toBeDefined();
    expect(interestTxn!.debit_amount).toBeCloseTo(row2.interest_expense, 2);
  });

  it('posts month 12 correctly (last month)', () => {
    const lease = makeLease();
    const storedSchedules = buildStoredSchedule(lease);
    const txns = generateMonthEndTransactions([lease], '2026-12', storedSchedules);

    const stored = storedSchedules.get(lease.id)!;
    const row12 = stored[11]; // period_number = 12

    const interestTxn = txns.find(t => t.transaction_type === 'interest');
    expect(interestTxn).toBeDefined();
    expect(interestTxn!.debit_amount).toBeCloseTo(row12.interest_expense, 2);
  });

  it('skips lease with no stored schedule and returns it in skipped list', () => {
    const lease = makeLease();
    const result = generateMonthEndTransactionsWithSkips([lease], '2026-01', undefined);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedLeases).toHaveLength(1);
    expect(result.skippedLeases[0].lease_id).toBe(lease.id);
    expect(result.skippedLeases[0].reason).toContain('No amortization schedule');
  });

  it('every transaction has equal debits and credits across all 12 months', () => {
    const lease = makeLease();
    const storedSchedules = buildStoredSchedule(lease);
    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`;
      const txns = generateMonthEndTransactions([lease], period, storedSchedules);
      for (const t of txns) {
        expect(t.debit_amount).toBe(t.credit_amount);
      }
    }
  });

  it('semi-annual payment lease posts cash only in scheduled months', () => {
    const lease = makeLease({
      payment_amount: 6000,
      payment_frequency: 'semi_annually',
      payment_timing: 'end',
    });
    const storedSchedules = buildStoredSchedule(lease);
    const stored = storedSchedules.get(lease.id)!;

    // Semi-annual with end timing: payments in months 6 and 12
    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`;
      const txns = generateMonthEndTransactions([lease], period, storedSchedules);
      const paymentTxn = txns.find(t => t.transaction_type === 'payment');
      const expectedPayment = stored[m - 1].payment_amount;

      if (expectedPayment > 0) {
        expect(paymentTxn).toBeDefined();
        expect(paymentTxn!.debit_amount).toBeCloseTo(expectedPayment, 2);
      } else {
        expect(paymentTxn).toBeUndefined();
      }
    }
  });

  it('annual payment lease posts cash only in month 12', () => {
    const lease = makeLease({
      payment_amount: 12000,
      payment_frequency: 'annually',
      payment_timing: 'end',
    });
    const storedSchedules = buildStoredSchedule(lease);
    const stored = storedSchedules.get(lease.id)!;

    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`;
      const txns = generateMonthEndTransactions([lease], period, storedSchedules);
      const paymentTxn = txns.find(t => t.transaction_type === 'payment');
      const expectedPayment = stored[m - 1].payment_amount;

      if (expectedPayment > 0) {
        expect(paymentTxn).toBeDefined();
        expect(paymentTxn!.debit_amount).toBeCloseTo(expectedPayment, 2);
      } else {
        expect(paymentTxn).toBeUndefined();
      }
    }
  });
});

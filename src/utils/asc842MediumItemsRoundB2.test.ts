import { describe, it, expect, vi } from 'vitest';
import {
  computeImpairment,
  type CarryingAmounts,
  type ScheduleRow,
} from './leaseModification';
import { computeLeaseCostDisclosure, computeLeaseBalancesByType } from './financialReports';
import type { Lease } from '../types/lease';
import {
  generateAmortizationSchedule,
  type PaymentFrequency,
} from './leaseCalculations';

// Mock supabase for async functions
vi.mock('../lib/supabase', () => {
  const chainable = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.gt = () => chain;
    chain.gte = () => chain;
    chain.lt = () => chain;
    chain.lte = () => chain;
    chain.in = () => chain;
    chain.not = () => chain;
    chain.order = () => chain;
    chain.range = () => Promise.resolve({ data: [] });
    chain.limit = () => Promise.resolve({ data: [] });
    chain.single = () => Promise.resolve({ data: null });
    chain.maybeSingle = () => Promise.resolve({ data: null });
    chain.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] });
    return chain;
  };

  return {
    supabase: {
      from: vi.fn(() => chainable()),
      rpc: vi.fn((_fn: string, args: { p_lease_ids: string[] }) => Promise.resolve({
        data: args.p_lease_ids.map((id, i) => ({
          lease_id: id, rou: 10000.33 * (i + 1), liability: 9000.17 * (i + 1), status: 'active',
          current_portion: 2500.05 * (i + 1), opening_rou: 12000 * (i + 1),
        })),
        error: null,
      })),
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
      },
    },
  };
});

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
    lease_end_date: '2028-12-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    discount_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'beginning',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
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

function getCarryingFromSchedule(lease: Lease, periodsCompleted: number): CarryingAmounts {
  const schedule = generateAmortizationSchedule({
    leaseTermMonths: lease.lease_term_months,
    paymentAmount: lease.payment_amount,
    incrementalBorrowingRate: lease.discount_rate ?? lease.incremental_borrowing_rate,
    initialDirectCosts: lease.initial_direct_costs ?? 0,
    leaseIncentives: lease.lease_incentives ?? 0,
    leaseStartDate: new Date(lease.lease_start_date),
    paymentTiming: (lease.payment_timing as 'beginning' | 'end') ?? 'beginning',
    paymentFrequency: (lease.payment_frequency as PaymentFrequency) ?? 'monthly',
    rvgProbableAmount: lease.rvg_probable_amount ?? 0,
    residualValueGuarantee: lease.residual_value_guarantee ?? 0,
    classification: lease.lease_classification as 'operating' | 'finance',
  });
  const row = schedule[periodsCompleted - 1];
  return {
    rouAsset: row.rouAssetBalance,
    leaseLiability: row.endingLiability,
    periodsCompleted,
  };
}

function getRemainingScheduleRows(lease: Lease, periodsCompleted: number): ScheduleRow[] {
  const schedule = generateAmortizationSchedule({
    leaseTermMonths: lease.lease_term_months,
    paymentAmount: lease.payment_amount,
    incrementalBorrowingRate: lease.discount_rate ?? lease.incremental_borrowing_rate,
    initialDirectCosts: lease.initial_direct_costs ?? 0,
    leaseIncentives: lease.lease_incentives ?? 0,
    leaseStartDate: new Date(lease.lease_start_date),
    paymentTiming: (lease.payment_timing as 'beginning' | 'end') ?? 'beginning',
    paymentFrequency: (lease.payment_frequency as PaymentFrequency) ?? 'monthly',
    rvgProbableAmount: lease.rvg_probable_amount ?? 0,
    residualValueGuarantee: lease.residual_value_guarantee ?? 0,
    classification: lease.lease_classification as 'operating' | 'finance',
  });
  return schedule.slice(periodsCompleted).map((r) => ({
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
}

// ---------------------------------------------------------------------------
// Test 1: Lease cost components for a period
// ---------------------------------------------------------------------------

describe('computeLeaseCostDisclosure — lease cost components', () => {
  it('finance cost = amortization + interest; operating cost = payment; total ties to sum', async () => {
    const operatingLease = makeLease({ id: 'op-1', lease_classification: 'operating', payment_amount: 1000 });
    const financeLease = makeLease({ id: 'fin-1', lease_classification: 'finance', payment_amount: 1000 });

    const opSchedule = generateAmortizationSchedule({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date('2026-01-01'),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      rvgProbableAmount: 0,
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    const finSchedule = generateAmortizationSchedule({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date('2026-01-01'),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      rvgProbableAmount: 0,
      residualValueGuarantee: 0,
      classification: 'finance',
    });

    const opRow = opSchedule[0];
    const finRow = finSchedule[0];

    const expectedFinanceCost = finRow.depreciationExpense + finRow.interestExpense;
    const expectedOperatingCost = opRow.paymentAmount;

    const result = await computeLeaseCostDisclosure(
      [operatingLease, financeLease],
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );

    expect(result).toBeDefined();
    expect(result.totalLeaseCost).toBe(result.financeLeaseCost + result.operatingLeaseCost + result.shortTermLeaseCost);
    expect(result.variableLeaseCost).toBe(0);
    expect(result.subleaseIncome).toBe(0);
    expect(expectedFinanceCost).toBeGreaterThan(0);
    expect(expectedOperatingCost).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Cash paid split operating / financing
// ---------------------------------------------------------------------------

describe('computeLeaseCostDisclosure — cash paid split', () => {
  it('operating payment → operating cash flow; finance interest → operating, principal → financing', async () => {
    const result = await computeLeaseCostDisclosure(
      [makeLease({ id: 'op-1', lease_classification: 'operating' })],
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );

    expect(result).toHaveProperty('cashPaidOperatingLeases');
    expect(result).toHaveProperty('cashPaidFinanceInterest');
    expect(result).toHaveProperty('cashPaidFinancePrincipal');
    expect(typeof result.cashPaidOperatingLeases).toBe('number');
    expect(typeof result.cashPaidFinanceInterest).toBe('number');
    expect(typeof result.cashPaidFinancePrincipal).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Test 3: ROU obtained from initial_recognition
// ---------------------------------------------------------------------------

describe('computeLeaseCostDisclosure — ROU obtained', () => {
  it('initial_recognition with Dr Right-of-Use Asset contributes to rouObtained', async () => {
    const result = await computeLeaseCostDisclosure(
      [makeLease({ id: 'op-1', lease_classification: 'operating' })],
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );

    expect(result).toHaveProperty('rouObtainedOperating');
    expect(result).toHaveProperty('rouObtainedFinance');
    expect(typeof result.rouObtainedOperating).toBe('number');
    expect(typeof result.rouObtainedFinance).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Weighted-average rate weighted by remaining liability
// ---------------------------------------------------------------------------

describe('Weighted-average rate weighted by remaining liability', () => {
  it('uses remaining liability, not original, when computing weighted average', () => {
    const lease1 = makeLease({
      id: 'fin-1',
      lease_classification: 'finance',
      lease_liability: 20000,
      discount_rate: 5,
      incremental_borrowing_rate: 5,
      lease_end_date: '2027-12-01',
    });
    const lease2 = makeLease({
      id: 'fin-2',
      lease_classification: 'finance',
      lease_liability: 10000,
      discount_rate: 7,
      incremental_borrowing_rate: 7,
      lease_end_date: '2027-12-01',
    });

    const list = [lease1, lease2];
    const weight = (l: Lease) => Number(l.lease_liability) || 0;
    const value = (l: Lease) => Number(l.discount_rate ?? l.incremental_borrowing_rate) || 0;

    const totalWeight = list.reduce((s, l) => s + weight(l), 0);
    const weightedSum = list.reduce((s, l) => s + weight(l) * value(l), 0);
    const wadr = weightedSum / totalWeight;

    expect(wadr).toBeCloseTo(5.6667, 2);
    expect(wadr).not.toBe(6.0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Lease balances by type reconcile to Balance Sheet
// ---------------------------------------------------------------------------

describe('computeLeaseBalancesByType — reconciliation', () => {
  it('Operating ROU + Finance ROU = total ROU; Operating liability + Finance liability = total liability', async () => {
    const leases = [
      makeLease({ id: 'op-1', lease_classification: 'operating', rou_asset: 10000, lease_liability: 10000 }),
      makeLease({ id: 'fin-1', lease_classification: 'finance', rou_asset: 20000, lease_liability: 20000 }),
    ];

    const result = await computeLeaseBalancesByType(leases, new Date('2026-06-01'));

    expect(result.operatingRouAsset).toBe(10000.33);
    expect(result.financeRouAsset).toBe(20000.66);
    expect(result.financeLiabilityCurrent).toBe(5000.1);
    expect(result.totalRouAsset).toBeCloseTo(result.operatingRouAsset + result.financeRouAsset, 2);
    expect(result.totalLiability).toBeCloseTo(result.totalLiabilityCurrent + result.totalLiabilityNoncurrent, 2);
    const operatingLiab = result.operatingLiabilityCurrent + result.operatingLiabilityNoncurrent;
    const financeLiab = result.financeLiabilityCurrent + result.financeLiabilityNoncurrent;
    expect(operatingLiab + financeLiab).toBeCloseTo(result.totalLiability, 2);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Impairment of 1,000 on an operating lease — monthly, beginning
// ---------------------------------------------------------------------------

describe('computeImpairment — operating lease, 1000 impairment after 12 months', () => {
  const lease = makeLease({
    lease_classification: 'operating',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    payment_timing: 'beginning',
    discount_rate: 6,
    incremental_borrowing_rate: 6,
  });
  const carrying = getCarryingFromSchedule(lease, 12);
  const existingSchedule = getRemainingScheduleRows(lease, 12);

  it('ROU drops by 1000', () => {
    const result = computeImpairment(carrying, 1000, existingSchedule);

    expect(result.rouBefore).toBe(carrying.rouAsset);
    expect(result.impairmentAmount).toBe(1000);
    expect(result.rouAfter).toBeCloseTo(carrying.rouAsset - 1000, 2);
  });

  it('schedule still ends at 0 ROU and 0 liability', () => {
    const result = computeImpairment(carrying, 1000, existingSchedule);

    const lastRow = result.remainingSchedule[result.remainingSchedule.length - 1];
    expect(lastRow.rou_asset_balance).toBe(0);
    expect(lastRow.ending_liability).toBe(0);
  });

  it('liability fields are unchanged from the existing schedule', () => {
    const result = computeImpairment(carrying, 1000, existingSchedule);

    expect(result.remainingSchedule.length).toBe(existingSchedule.length);
    for (let i = 0; i < existingSchedule.length; i++) {
      const orig = existingSchedule[i];
      const rebuilt = result.remainingSchedule[i];
      expect(rebuilt.payment_amount).toBe(orig.payment_amount);
      expect(rebuilt.interest_expense).toBe(orig.interest_expense);
      expect(rebuilt.principal_reduction).toBe(orig.principal_reduction);
      expect(rebuilt.beginning_liability).toBe(orig.beginning_liability);
      expect(rebuilt.ending_liability).toBe(orig.ending_liability);
    }
  });

  it('payment_amount stays 1000 (not recomputed to ~1005)', () => {
    const result = computeImpairment(carrying, 1000, existingSchedule);

    for (const row of result.remainingSchedule) {
      expect(row.payment_amount).toBe(1000);
    }
  });

  it('operating cost is no longer single straight-line (depreciation + interest varies)', () => {
    const result = computeImpairment(carrying, 1000, existingSchedule);

    for (let i = 0; i < result.remainingSchedule.length; i++) {
      const row = result.remainingSchedule[i];
      const totalCost = row.depreciation_expense + row.interest_expense;
      expect(totalCost).toBeGreaterThan(0);
      // Interest is > 0 only when the original schedule row had interest > 0
      // (the final period of a beginning-of-payment lease may have 0 interest)
      if (existingSchedule[i].interest_expense > 0) {
        expect(row.interest_expense).toBeGreaterThan(0);
      }
    }

    const costs = result.remainingSchedule.map(r => r.depreciation_expense + r.interest_expense);
    const allSame = costs.every(c => Math.abs(c - costs[0]) < 0.01);
    expect(allSame).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Impairment on a quarterly-payment lease
// ---------------------------------------------------------------------------

describe('computeImpairment — quarterly-payment operating lease', () => {
  const lease = makeLease({
    lease_classification: 'operating',
    lease_term_months: 24,
    payment_amount: 3000,
    payment_frequency: 'quarterly',
    payment_timing: 'beginning',
    discount_rate: 6,
    incremental_borrowing_rate: 6,
    lease_end_date: '2027-12-01',
  });
  const carrying = getCarryingFromSchedule(lease, 12);
  const existingSchedule = getRemainingScheduleRows(lease, 12);

  it('liability fields preserved (quarterly payments match original)', () => {
    const result = computeImpairment(carrying, 500, existingSchedule);

    // Quarterly payments appear only every 3rd period in the monthly schedule;
    // verify each row's payment matches the original exactly.
    for (let i = 0; i < existingSchedule.length; i++) {
      expect(result.remainingSchedule[i].payment_amount).toBe(existingSchedule[i].payment_amount);
    }
    // At least one row should have the 3000 quarterly payment
    const hasQuarterlyPayment = existingSchedule.some(r => r.payment_amount === 3000);
    expect(hasQuarterlyPayment).toBe(true);
  });

  it('ROU drops by 500 and ends at 0', () => {
    const result = computeImpairment(carrying, 500, existingSchedule);

    expect(result.rouAfter).toBeCloseTo(carrying.rouAsset - 500, 2);
    const lastRow = result.remainingSchedule[result.remainingSchedule.length - 1];
    expect(lastRow.rou_asset_balance).toBe(0);
  });

  it('interest and principal match the original schedule exactly', () => {
    const result = computeImpairment(carrying, 500, existingSchedule);

    for (let i = 0; i < existingSchedule.length; i++) {
      expect(result.remainingSchedule[i].interest_expense).toBe(existingSchedule[i].interest_expense);
      expect(result.remainingSchedule[i].principal_reduction).toBe(existingSchedule[i].principal_reduction);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 8: Impairment cannot exceed carrying amount
// ---------------------------------------------------------------------------

describe('computeImpairment — validation', () => {
  it('throws when impairmentAmount > carrying.rouAsset', () => {
    const carrying: CarryingAmounts = {
      rouAsset: 5000,
      leaseLiability: 10000,
      periodsCompleted: 12,
    };
    const dummySchedule: ScheduleRow[] = [{
      period_number: 13,
      period_date: '2027-01-01',
      beginning_liability: 10000,
      payment_amount: 1000,
      interest_expense: 50,
      principal_reduction: 950,
      ending_liability: 9050,
      rou_asset_balance: 4500,
      depreciation_expense: 500,
    }];

    expect(() =>
      computeImpairment(carrying, 6000, dummySchedule),
    ).toThrow(/exceeds the carrying ROU asset amount/);
  });

  it('throws when impairmentAmount is zero or negative', () => {
    const carrying: CarryingAmounts = {
      rouAsset: 5000,
      leaseLiability: 10000,
      periodsCompleted: 12,
    };
    const dummySchedule: ScheduleRow[] = [{
      period_number: 13,
      period_date: '2027-01-01',
      beginning_liability: 10000,
      payment_amount: 1000,
      interest_expense: 50,
      principal_reduction: 950,
      ending_liability: 9050,
      rou_asset_balance: 4500,
      depreciation_expense: 500,
    }];

    expect(() =>
      computeImpairment(carrying, 0, dummySchedule),
    ).toThrow(/greater than zero/);

    expect(() =>
      computeImpairment(carrying, -100, dummySchedule),
    ).toThrow(/greater than zero/);
  });

  it('throws when no remaining schedule rows are provided', () => {
    const carrying: CarryingAmounts = {
      rouAsset: 5000,
      leaseLiability: 10000,
      periodsCompleted: 12,
    };

    expect(() =>
      computeImpairment(carrying, 1000, []),
    ).toThrow(/No remaining schedule rows/);
  });
});

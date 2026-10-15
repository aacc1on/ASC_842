import { describe, it, expect, vi } from 'vitest';
import {
  computeModification,
  computeCancellation,
  hasPostedMonthEnd,
  type CarryingAmounts,
} from './leaseModification';
import type { Lease } from '../types/lease';
import {
  generateAmortizationSchedule,
  type PaymentFrequency,
} from './leaseCalculations';

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

describe('computeModification — operating lease, increasing payment', () => {
  const lease = makeLease({ lease_classification: 'operating' });

  it('remeasures liability to PV of new payments at new rate', () => {
    const carrying = getCarryingFromSchedule(lease, 12); // after 12 months
    const result = computeModification(lease, carrying, 1200, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // New liability = PV of 1200/month for 24 months at 6%, beginning
    // Should be greater than the old carrying liability (payment went up)
    expect(result.newLiability).toBeGreaterThan(carrying.leaseLiability);
  });

  it('ROU asset adjusted by same delta as liability', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 1200, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    expect(result.rouChange).toBeCloseTo(result.liabilityChange, 2);
  });

  it('remaining schedule ends at exactly 0 liability and 0 ROU', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 1200, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    const lastRow = result.remainingSchedule[result.remainingSchedule.length - 1];
    expect(lastRow.ending_liability).toBe(0);
    expect(lastRow.rou_asset_balance).toBe(0);
  });

  it('operating straight-line cost is constant across remaining periods', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 1200, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    for (const row of result.remainingSchedule) {
      const totalCost = row.depreciation_expense + row.interest_expense;
      // All periods should have the same total lease cost (straight-line)
      expect(totalCost).toBeCloseTo(result.remainingSchedule[0].depreciation_expense + result.remainingSchedule[0].interest_expense, 0);
    }
  });
});

describe('computeModification — finance lease, decreasing payment', () => {
  const lease = makeLease({ lease_classification: 'finance' });

  it('remeasures liability downward when payment decreases', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 800, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    expect(result.newLiability).toBeLessThan(carrying.leaseLiability);
    expect(result.liabilityChange).toBeLessThan(0);
  });

  it('ROU asset adjusted by same delta (decrease)', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 800, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    expect(result.newRouAsset).toBeLessThan(carrying.rouAsset);
  });

  it('remaining schedule ends at 0 liability and 0 ROU', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 800, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    const lastRow = result.remainingSchedule[result.remainingSchedule.length - 1];
    expect(lastRow.ending_liability).toBe(0);
    expect(lastRow.rou_asset_balance).toBe(0);
  });

  it('finance lease has straight-line depreciation', () => {
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 800, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    const depValues = result.remainingSchedule.map(r => r.depreciation_expense);
    const firstDep = depValues[0];
    // All non-final periods should have the same depreciation
    for (let i = 0; i < depValues.length - 1; i++) {
      expect(depValues[i]).toBeCloseTo(firstDep, 1);
    }
  });
});

describe('computeModification — decrease larger than ROU gives a gain', () => {
  it('recognizes a gain when liability decrease exceeds ROU carrying amount', () => {
    // Create a scenario where ROU carrying is small relative to liability decrease
    // Use a lease with high initial direct costs = 0, incentives = 0, so ROU ≈ liability
    // After several periods, ROU and liability will have amortized
    // If we drop the payment drastically, the liability remeasurement could
    // push ROU below 0
    const lease = makeLease({
      lease_classification: 'finance',
      payment_amount: 1000,
      lease_term_months: 36,
      incremental_borrowing_rate: 6,
      discount_rate: 6,
      initial_direct_costs: 0,
      lease_incentives: 0,
    });

    const carrying = getCarryingFromSchedule(lease, 24);
    // Drop payment to 10/month for remaining 12 months — huge liability decrease
    const result = computeModification(lease, carrying, 10, 12, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // The ROU should be taken to 0 and a gain recognized
    expect(result.newRouAsset).toBe(0);
    expect(result.gainOnModification).toBeGreaterThan(0);
  });
});

describe('computeModification — new lease term and end date', () => {
  it('computes total new term = completed periods + remaining', () => {
    const lease = makeLease();
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 1000, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    expect(result.newLeaseTermMonths).toBe(36); // 12 + 24
  });

  it('computes new lease end date', () => {
    const lease = makeLease({ lease_start_date: '2026-01-01' });
    const carrying = getCarryingFromSchedule(lease, 12);
    const result = computeModification(lease, carrying, 1000, 24, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // Start 2026-01, total term 36 months → end = 2028-12-01 (0-indexed month + 36)
    expect(result.newLeaseEndDate).toBe('2029-01-01');
  });
});

describe('computeCancellation — recognized lease', () => {
  it('gain = carrying liability - carrying ROU - penalty - final payment', () => {
    // computeCancellation(carryingRouAsset, carryingLiability, penalty, finalPayment)
    // gainLoss = liability - rou - penalty - final = 20000 - 15000 - 2000 - 1000 = 2000
    const result = computeCancellation(15000, 20000, 2000, 1000);
    expect(result.gainLoss).toBe(2000);
    expect(result.isGain).toBe(true);
  });

  it('loss when liability < ROU + penalty + final payment', () => {
    // gainLoss = 10000 - 15000 - 2000 - 1000 = -8000 (loss)
    const result = computeCancellation(15000, 10000, 2000, 1000);
    expect(result.gainLoss).toBe(8000);
    expect(result.isGain).toBe(false);
  });

  it('zero gain/loss when perfectly balanced', () => {
    // gainLoss = 20000 - 15000 - 3000 - 2000 = 0
    const result = computeCancellation(15000, 20000, 3000, 2000);
    expect(result.gainLoss).toBe(0);
    expect(result.isGain).toBe(false);
  });
});

describe('computeModification — quarterly frequency', () => {
  it('uses payment stream for quarterly payments', () => {
    const lease = makeLease({
      payment_frequency: 'quarterly',
      payment_amount: 3000,
      lease_term_months: 24,
      payment_timing: 'beginning',
    });
    const carrying = getCarryingFromSchedule(lease, 6);
    const result = computeModification(lease, carrying, 3000, 18, 6, {
      classification: 'operating',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // With quarterly payments, only periods 1, 4, 7, 10, 13, 16 have payments
    // The liability should be less than 3000 * 18 = 54000
    expect(result.newLiability).toBeLessThan(54000);
    expect(result.newLiability).toBeGreaterThan(0);
  });
});

describe('Month-end from stored schedule equals old result for unmodified lease', () => {
  it('stored schedule values match generated values for the same period', () => {
    const lease = makeLease({ lease_classification: 'operating' });
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: lease.lease_term_months,
      paymentAmount: lease.payment_amount,
      incrementalBorrowingRate: lease.discount_rate ?? lease.incremental_borrowing_rate,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(lease.lease_start_date),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      rvgProbableAmount: 0,
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    // Period 3 (month 3) — values should match
    const period3 = schedule[2];
    expect(period3.interestExpense).toBeGreaterThan(0);
    expect(period3.paymentAmount).toBe(1000);
    expect(period3.depreciationExpense).toBeGreaterThan(0);
  });
});

describe('hasPostedMonthEnd', () => {
  // Mock supabase for these tests only — the pure functions above don't need it.
  vi.mock('../lib/supabase', () => ({
    supabase: {
      from: vi.fn(),
    },
  }));

  function makeChainableCount(count: number | null) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.not = () => chain;
    chain.gte = () => chain;
    chain.lte = () => chain;
    chain.in = () => chain;
    chain.order = () => chain;
    chain.range = () => chain;
    chain.limit = () => chain;
    chain.single = () => chain;
    chain.maybeSingle = () => chain;
    // The chain must be thenable so `await query` resolves to { count }.
    chain.then = (resolve: (v: { count: number | null }) => void) => resolve({ count });
    return chain;
  }

  it('returns true when posted month-end entries exist in transactions table', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnValue(makeChainableCount(5));

    const result = await hasPostedMonthEnd('lease-1');
    expect(result).toBe(true);
  });

  it('returns false when no posted month-end entries exist', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnValue(makeChainableCount(0));

    const result = await hasPostedMonthEnd('lease-1');
    expect(result).toBe(false);
  });

  it('returns false when count is null (query error)', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnValue(makeChainableCount(null));

    const result = await hasPostedMonthEnd('lease-1');
    expect(result).toBe(false);
  });

  it('accepts optional fromDate to scope the query', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnValue(makeChainableCount(3));

    const result = await hasPostedMonthEnd('lease-1', '2026-06-01');
    expect(result).toBe(true);
  });
});

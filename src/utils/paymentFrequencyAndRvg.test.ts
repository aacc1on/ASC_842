import { describe, it, expect } from 'vitest';
import {
  buildPaymentStream,
  calculateLeaseMetrics,
  calculatePresentValueStream,
  generateAmortizationSchedule,
  type PaymentFrequency,
} from './leaseCalculations';
import { generateInitialRecognitionTransactions } from './transactionGenerator';
import { generateMonthEndTransactions } from './monthEndTransactions';
import { buildStoredSchedulesForLeases } from './testScheduleHelper';
import type { Lease } from '../types/lease';

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'test-lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-12-01',
    lease_term_months: 12,
    payment_amount: 30000,
    payment_frequency: 'quarterly',
    incremental_borrowing_rate: 6,
    lease_classification: 'finance',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 0,
    lease_liability: 0,
    status: 'active',
    payment_timing: 'beginning',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 0,
    asset_market_value: 0,
    asset_economic_life_months: 0,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    paymentTranches: [],
    ...overrides,
  } as Lease;
}

describe('Payment frequency — quarterly beginning 30,000 for 12 months at 6%', () => {
  const freq: PaymentFrequency = 'quarterly';
  const term = 12;
  const payment = 30000;
  const rate = 6;

  it('payments only in periods 1, 4, 7, 10', () => {
    const stream = buildPaymentStream(term, payment, undefined, freq, 'beginning');
    expect(stream).toHaveLength(12);
    expect(stream[0]).toBe(30000);  // period 1
    expect(stream[1]).toBe(0);       // period 2
    expect(stream[2]).toBe(0);       // period 3
    expect(stream[3]).toBe(30000);  // period 4
    expect(stream[4]).toBe(0);
    expect(stream[5]).toBe(0);
    expect(stream[6]).toBe(30000);  // period 7
    expect(stream[7]).toBe(0);
    expect(stream[8]).toBe(0);
    expect(stream[9]).toBe(30000);  // period 10
    expect(stream[10]).toBe(0);
    expect(stream[11]).toBe(0);
  });

  it('liability equals PV of the quarterly stream (~117,350, not ~350,300)', () => {
    const stream = buildPaymentStream(term, payment, undefined, freq, 'beginning');
    const pv = calculatePresentValueStream(stream, rate, 'beginning');
    // PV of 30000 at periods 0,3,6,9 (beginning, 0-indexed) at 0.5% monthly
    // = 30000 * (1 + 1/(1.005^3) + 1/(1.005^6) + 1/(1.005^9))
    expect(pv).toBeLessThan(130000);
    expect(pv).toBeGreaterThan(110000);
  });

  it('calculateLeaseMetrics uses the stream, not the annuity formula', () => {
    const metrics = calculateLeaseMetrics({
      leaseTermMonths: term,
      paymentAmount: payment,
      incrementalBorrowingRate: rate,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: freq,
      classification: 'finance',
    });
    expect(metrics.leaseLiability).toBeLessThan(130000);
    expect(metrics.leaseLiability).toBeGreaterThan(110000);
  });
});

describe('Payment frequency — annual end-timing', () => {
  it('payment only in period 12 with end timing', () => {
    const stream = buildPaymentStream(12, 120000, undefined, 'annually', 'end');
    for (let i = 0; i < 11; i++) {
      expect(stream[i]).toBe(0);
    }
    expect(stream[11]).toBe(120000);
  });
});

describe('Payment frequency — weekly', () => {
  it('weekly payment_amount * 52 / 12 every month', () => {
    const stream = buildPaymentStream(12, 1000, undefined, 'weekly', 'beginning');
    const expected = Math.round((1000 * 52 / 12) * 100) / 100;
    expect(stream[0]).toBeCloseTo(expected, 1);
    expect(stream[1]).toBeCloseTo(expected, 1);
    expect(stream.every((v) => Math.abs(v - expected) < 0.01)).toBe(true);
  });
});

describe('Payment frequency — quarterly with tranches', () => {
  it('tranche amount is the amount per payment and follows frequency rule', () => {
    const tranches = [{ fromMonth: 1, toMonth: 6, paymentAmount: 30000 }, { fromMonth: 7, toMonth: 12, paymentAmount: 40000 }];
    const stream = buildPaymentStream(12, 30000, tranches, 'quarterly', 'beginning');
    // Periods 1, 4 → 30000 (tranche 1)
    // Periods 7, 10 → 40000 (tranche 2)
    expect(stream[0]).toBe(30000);
    expect(stream[3]).toBe(30000);
    expect(stream[6]).toBe(40000);
    expect(stream[9]).toBe(40000);
    // Non-payment months are 0
    expect(stream[1]).toBe(0);
    expect(stream[5]).toBe(0);
  });
});

describe('Operating straight-line cost with quarterly payments', () => {
  it('equals total payments / months every month', () => {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 12,
      paymentAmount: 30000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'quarterly',
      classification: 'operating',
    });

    // Total payments = 30000 * 4 = 120000; straight-line = 120000/12 = 10000
    const totalPayments = 120000;
    const expectedMonthlyCost = totalPayments / 12;

    // The sum of depreciation + interest should equal straight-line cost
    for (const row of schedule) {
      const totalCost = row.depreciationExpense + row.interestExpense;
      expect(totalCost).toBeCloseTo(expectedMonthlyCost, 0);
    }
  });
});

describe('Month-end entries for a quarterly lease', () => {
  it('Cash only in payment months, accrued liability in others', () => {
    const lease = makeLease({
      payment_amount: 30000,
      payment_frequency: 'quarterly',
      payment_timing: 'beginning',
      lease_term_months: 12,
      incremental_borrowing_rate: 6,
      lease_classification: 'finance',
      discount_rate: 6,
      rou_asset: 117350,
      lease_liability: 117350,
    });

    const stored = buildStoredSchedulesForLeases([lease]);

    // Period 1 (January) — payment month (beginning timing, quarter → period 1)
    const janTxns = generateMonthEndTransactions([lease], '2026-01', stored);
    const janPayment = janTxns.find((t) => t.transaction_type === 'payment');
    expect(janPayment).toBeDefined();
    expect(janPayment!.debit_amount).toBe(30000);

    // Period 2 (February) — no payment, only interest
    const febTxns = generateMonthEndTransactions([lease], '2026-02', stored);
    const febPayment = febTxns.find((t) => t.transaction_type === 'payment');
    expect(febPayment).toBeUndefined();
    const febInterest = febTxns.find((t) => t.transaction_type === 'interest');
    expect(febInterest).toBeDefined();
  });
});

describe('RVG probable amount — ASC 842-10-30-5(f)', () => {
  it('full guarantee 10,000 with probable 2,000 measures only PV of 2,000', () => {
    const metrics = calculateLeaseMetrics({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 10000,
      rvgProbableAmount: 2000,
      classification: 'finance',
    });

    // PV of 2000 at period 12 (end of term) at 0.5% monthly
    const monthlyRate = 0.06 / 12;
    const pvRvg = 2000 / Math.pow(1 + monthlyRate, 12);

    // The liability should include only pvRvg, not the PV of 10000
    const pvRvgFull = 10000 / Math.pow(1 + monthlyRate, 12);
    expect(metrics.leaseLiability).toBeLessThan(metrics.leaseLiability - pvRvg + pvRvgFull);
    // Verify the difference is exactly the difference between PV of 2000 and PV of 10000
    const metricsWithoutRvg = calculateLeaseMetrics({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      rvgProbableAmount: 0,
      classification: 'finance',
    });
    expect(metrics.leaseLiability - metricsWithoutRvg.leaseLiability).toBeCloseTo(pvRvg, 0);
  });

  it('no RVG Payable entry in initial recognition transactions', async () => {
    const lease = makeLease({
      residual_value_guarantee: 10000,
      rvg_probable_amount: 2000,
      rou_asset: 50000,
      lease_liability: 50000,
    });

    const txns = await generateInitialRecognitionTransactions(lease, 'user-1');
    const rvgPayable = txns.find((t) => t.account_credited === 'Residual Value Guarantee Payable');
    expect(rvgPayable).toBeUndefined();
  });

  it('schedule final-period payment includes rvgProbableAmount, not full guarantee', () => {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 10000,
      rvgProbableAmount: 2000,
      classification: 'finance',
    });

    const finalRow = schedule[schedule.length - 1];
    // Final payment = 1000 (monthly) + 2000 (probable RVG) = 3000
    expect(finalRow.paymentAmount).toBe(3000);
    // Should NOT be 1000 + 10000 = 11000
    expect(finalRow.paymentAmount).not.toBe(11000);
  });
});

describe('Existing monthly leases give identical results to before', () => {
  it('monthly frequency produces the same stream as the old level-payment approach', () => {
    const stream = buildPaymentStream(12, 1000, undefined, 'monthly', 'beginning');
    expect(stream.every((v) => v === 1000)).toBe(true);
  });

  it('monthly metrics match the annuity formula for level payments', () => {
    const metrics = calculateLeaseMetrics({
      leaseTermMonths: 36,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      rvgProbableAmount: 0,
      classification: 'finance',
    });

    // PV of annuity due: 1000 * (1 - 1.005^-36) / 0.005 * 1.005
    const r = 0.005;
    const pvOrdinary = 1000 * (1 - Math.pow(1 + r, -36)) / r;
    const pvDue = pvOrdinary * (1 + r);
    expect(metrics.leaseLiability).toBeCloseTo(Math.round((pvDue + Number.EPSILON) * 100) / 100, 2);
  });

  it('rvgProbableAmount defaults to residualValueGuarantee when not specified (backwards compat)', () => {
    const metrics = calculateLeaseMetrics({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 5000,
      classification: 'finance',
    });

    const monthlyRate = 0.06 / 12;
    const pvRvg = 5000 / Math.pow(1 + monthlyRate, 12);
    const metricsNoRvg = calculateLeaseMetrics({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      paymentFrequency: 'monthly',
      residualValueGuarantee: 0,
      rvgProbableAmount: 0,
      classification: 'finance',
    });
    expect(metrics.leaseLiability - metricsNoRvg.leaseLiability).toBeCloseTo(pvRvg, 0);
  });
});

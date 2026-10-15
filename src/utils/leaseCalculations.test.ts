import { describe, it, expect } from 'vitest';
import {
  calculatePresentValue,
  calculateLeaseMetrics,
  generateAmortizationSchedule,
  round2,
  type LeaseInput,
} from './leaseCalculations';

// Reference Lease A: 36 monthly payments of $1,000, annual discount rate 6% (0.5%/month)
const RATE = 6;
const PAYMENT = 1000;
const TERM = 36;
const START_DATE = new Date(2026, 0, 1); // Jan 1, 2026

const baseInput = (overrides: Partial<LeaseInput> = {}): LeaseInput => ({
  leaseTermMonths: TERM,
  paymentAmount: PAYMENT,
  incrementalBorrowingRate: RATE,
  initialDirectCosts: 0,
  leaseIncentives: 0,
  leaseStartDate: START_DATE,
  classification: 'finance',
  ...overrides,
});

describe('calculatePresentValue', () => {
  it('(1) arrears (end of month) = $32,871.02', () => {
    const pv = calculatePresentValue(PAYMENT, TERM, RATE, 'end');
    expect(pv).toBeCloseTo(32871.02, 1);
  });

  it('(2) advance (beginning of month) = $33,035.37', () => {
    const pv = calculatePresentValue(PAYMENT, TERM, RATE, 'beginning');
    expect(pv).toBeCloseTo(33035.37, 1);
  });

  it('(10a) 0% discount rate = sum of payments = $36,000.00', () => {
    const pv = calculatePresentValue(PAYMENT, TERM, 0, 'end');
    expect(pv).toBe(36000);
  });

  it('(10a) 0% advance = sum of payments = $36,000.00', () => {
    const pv = calculatePresentValue(PAYMENT, TERM, 0, 'beginning');
    expect(pv).toBe(36000);
  });
});

describe('calculateLeaseMetrics', () => {
  it('arrears liability = $32,871.02', () => {
    const m = calculateLeaseMetrics(baseInput({ paymentTiming: 'end' }));
    expect(m.leaseLiability).toBeCloseTo(32871.02, 1);
  });

  it('advance liability = $33,035.37', () => {
    const m = calculateLeaseMetrics(baseInput({ paymentTiming: 'beginning' }));
    expect(m.leaseLiability).toBeCloseTo(33035.37, 1);
  });

  it('rouAsset equals liability when no IDC/incentives', () => {
    const m = calculateLeaseMetrics(baseInput({ paymentTiming: 'end' }));
    expect(m.rouAsset).toBe(m.leaseLiability);
  });
});

// --- OPERATING LEASE (arrears) ---
describe('generateAmortizationSchedule — operating lease, arrears', () => {
  const schedule = generateAmortizationSchedule(
    baseInput({ paymentTiming: 'end', classification: 'operating' })
  );

  it('(3) month-1 interest = $164.36', () => {
    expect(schedule[0].interestExpense).toBe(164.36);
  });

  it('(3) month-1 principal reduction = $835.64', () => {
    expect(schedule[0].principalReduction).toBe(835.64);
  });

  it('(3) liability after month 1 = $32,035.38', () => {
    expect(schedule[0].endingLiability).toBeCloseTo(32035.38, 1);
  });

  it('(7) liability ends at $0.00 (within $0.01) after last payment', () => {
    const last = schedule[schedule.length - 1];
    expect(last.endingLiability).toBeLessThanOrEqual(0.01);
  });

  it('(7) sum of all interest = total payments - initial liability ($3,128.98 within $0.05)', () => {
    const totalInterest = schedule.reduce((s, r) => s + r.interestExpense, 0);
    expect(Math.abs(totalInterest - 3128.98)).toBeLessThanOrEqual(0.05);
  });

  it('(5) straight-line lease cost = $1,000.00 every month (within $0.01)', () => {
    for (const row of schedule) {
      const leaseCost = round2(row.interestExpense + row.depreciationExpense);
      expect(Math.abs(leaseCost - 1000)).toBeLessThanOrEqual(0.01);
    }
  });

  it('(5) month-1 ROU reduction = $835.64 (straight-line cost minus interest)', () => {
    expect(schedule[0].depreciationExpense).toBe(835.64);
  });

  it('(5) total lease cost over term = $36,000.00 (within $0.02)', () => {
    const totalCost = schedule.reduce((s, r) => s + r.interestExpense + r.depreciationExpense, 0);
    expect(Math.abs(totalCost - 36000)).toBeLessThanOrEqual(0.02);
  });

  it('(new) ROU asset ends at $0.00 (within $0.01) after last period', () => {
    const last = schedule[schedule.length - 1];
    expect(last.rouAssetBalance).toBeLessThanOrEqual(0.01);
  });
});

// --- FINANCE LEASE (arrears) ---
describe('generateAmortizationSchedule — finance lease, arrears', () => {
  const schedule = generateAmortizationSchedule(
    baseInput({ paymentTiming: 'end', classification: 'finance' })
  );

  it('(6) month-1 interest expense = $164.36', () => {
    expect(schedule[0].interestExpense).toBe(164.36);
  });

  it('(6) straight-line ROU amortization = $913.08 per month ($32,871.02 / 36)', () => {
    const liability = calculateLeaseMetrics(baseInput({ paymentTiming: 'end' })).leaseLiability;
    const monthlyAmort = round2(liability / TERM);
    expect(monthlyAmort).toBe(913.08);
    expect(schedule[0].depreciationExpense).toBe(913.08);
  });

  it('(7) liability ends at $0.00 (within $0.01) after last payment', () => {
    const last = schedule[schedule.length - 1];
    expect(last.endingLiability).toBeLessThanOrEqual(0.01);
  });

  it('(7) sum of all interest = total payments - initial liability ($3,128.98 within $0.05)', () => {
    const totalInterest = schedule.reduce((s, r) => s + r.interestExpense, 0);
    expect(Math.abs(totalInterest - 3128.98)).toBeLessThanOrEqual(0.05);
  });

  it('(new) ROU asset ends at $0.00 (within $0.01) after last period', () => {
    const last = schedule[schedule.length - 1];
    expect(last.rouAssetBalance).toBeLessThanOrEqual(0.01);
  });
});

// --- ADVANCE (beginning of month) ---
describe('generateAmortizationSchedule — advance', () => {
  const schedule = generateAmortizationSchedule(
    baseInput({ paymentTiming: 'beginning', classification: 'finance' })
  );

  it('(4) end of month 1 liability = $32,195.55 (post-payment balance + accrued interest)', () => {
    expect(schedule[0].endingLiability).toBeCloseTo(32195.55, 1);
  });

  it('(4) month-1 interest on post-payment balance = $160.18', () => {
    expect(schedule[0].interestExpense).toBe(160.18);
  });

  it('(7) liability ends at $0.00 (within $0.01) after last payment', () => {
    const last = schedule[schedule.length - 1];
    expect(last.endingLiability).toBeLessThanOrEqual(0.01);
  });

  it('(7) sum of all interest within $0.05 of total payments - initial liability', () => {
    const totalInterest = schedule.reduce((s, r) => s + r.interestExpense, 0);
    const initialLiability = calculateLeaseMetrics(baseInput({ paymentTiming: 'beginning' })).leaseLiability;
    const expected = TERM * PAYMENT - initialLiability;
    expect(Math.abs(totalInterest - expected)).toBeLessThanOrEqual(0.05);
  });
});

describe('edge cases', () => {
  it('(10b) 1-month lease arrears: single payment, liability ends at 0', () => {
    const sched = generateAmortizationSchedule(
      baseInput({ leaseTermMonths: 1, paymentTiming: 'end', classification: 'finance' })
    );
    expect(sched).toHaveLength(1);
    expect(sched[0].endingLiability).toBeLessThanOrEqual(0.01);
  });

  it('(10b) 1-month lease advance: single payment, liability ends at 0', () => {
    const sched = generateAmortizationSchedule(
      baseInput({ leaseTermMonths: 1, paymentTiming: 'beginning', classification: 'finance' })
    );
    expect(sched).toHaveLength(1);
    expect(sched[0].endingLiability).toBeLessThanOrEqual(0.01);
  });

  it('(10c) zero payment amount produces no NaN in schedule', () => {
    const sched = generateAmortizationSchedule(
      baseInput({ paymentAmount: 0, classification: 'finance' })
    );
    for (const row of sched) {
      expect(isNaN(row.interestExpense)).toBe(false);
      expect(isNaN(row.principalReduction)).toBe(false);
      expect(isNaN(row.endingLiability)).toBe(false);
    }
  });

  it('(10c) negative payment amount produces no NaN in schedule', () => {
    const sched = generateAmortizationSchedule(
      baseInput({ paymentAmount: -100, classification: 'finance' })
    );
    for (const row of sched) {
      expect(isNaN(row.interestExpense)).toBe(false);
      expect(isNaN(row.principalReduction)).toBe(false);
      expect(isNaN(row.endingLiability)).toBe(false);
    }
  });

  it('(10a) 0% rate: present value = sum of payments, no division by zero', () => {
    const pv = calculatePresentValue(PAYMENT, TERM, 0, 'end');
    expect(pv).toBe(36000);
    expect(isFinite(pv)).toBe(true);
  });
});

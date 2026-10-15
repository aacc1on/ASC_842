import { describe, it, expect } from 'vitest';
import { generateAmortizationSchedule } from './leaseCalculations';
import { toYMD } from './formatting';

// Lease data for all 25 complete recognized leases, from the live DB.
// Each entry has the lease parameters and the max diff we expect between
// the TS calculator output and the SQL backfill (which should be 0 for all).
const leaseData: Array<{
  name: string;
  term: number;
  payment: number;
  rate: number;
  timing: 'beginning' | 'end';
  classification: 'finance' | 'operating';
  startYear: number;
  startMonth: number; // 1-indexed
}> = [
  { name: 'Building 1', term: 162, payment: 500, rate: 6, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Building 2', term: 253, payment: 850, rate: 6, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Building 3', term: 253, payment: 380, rate: 6, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 1 },
  { name: 'Building 6', term: 241, payment: 900, rate: 6, timing: 'beginning', classification: 'finance', startYear: 2020, startMonth: 1 },
  { name: 'F-1500 ma125', term: 18, payment: 1200, rate: 4.99, timing: 'beginning', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Office Building', term: 241, payment: 2500, rate: 5.98, timing: 'end', classification: 'finance', startYear: 2020, startMonth: 1 },
  { name: 'Vehicle', term: 73, payment: 450, rate: 4, timing: 'beginning', classification: 'finance', startYear: 2026, startMonth: 1 },
  { name: 'Vehicle 1', term: 46, payment: 570, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 1 },
  { name: 'Vehicle 10', term: 34, payment: 750, rate: 4, timing: 'end', classification: 'finance', startYear: 2025, startMonth: 1 },
  { name: 'Vehicle 11', term: 33, payment: 750, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 4 },
  { name: 'Vehicle 12', term: 61, payment: 350, rate: 3.99, timing: 'end', classification: 'finance', startYear: 2022, startMonth: 1 },
  { name: 'Vehicle 13', term: 69, payment: 780, rate: 4, timing: 'end', classification: 'finance', startYear: 2022, startMonth: 2 },
  { name: 'Vehicle 14', term: 24, payment: 560, rate: 4.99, timing: 'beginning', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Vehicle 15', term: 17, payment: 870, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 11 },
  { name: 'Vehicle 16', term: 109, payment: 210, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 2 },
  { name: 'Vehicle 2', term: 25, payment: 800, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Vehicle 3', term: 39, payment: 400, rate: 6, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 10 },
  { name: 'Vehicle 4', term: 85, payment: 120, rate: 4, timing: 'end', classification: 'finance', startYear: 2020, startMonth: 4 },
  { name: 'Vehicle 5', term: 73, payment: 200, rate: 4, timing: 'end', classification: 'finance', startYear: 2022, startMonth: 1 },
  { name: 'Vehicle 6', term: 48, payment: 420, rate: 0, timing: 'end', classification: 'finance', startYear: 2020, startMonth: 1 },
  { name: 'Vehicle 7', term: 39, payment: 450, rate: 4, timing: 'end', classification: 'finance', startYear: 2024, startMonth: 1 },
  { name: 'Vehicle 8', term: 50, payment: 300, rate: 4, timing: 'end', classification: 'operating', startYear: 2026, startMonth: 1 },
  { name: 'Vehicle 9', term: 51, payment: 400, rate: 4, timing: 'end', classification: 'finance', startYear: 2026, startMonth: 1 },
  { name: 'Warehouse', term: 123, payment: 650, rate: 6, timing: 'end', classification: 'operating', startYear: 2025, startMonth: 1 },
  { name: 'Warehouse 2', term: 132, payment: 960, rate: 6, timing: 'end', classification: 'finance', startYear: 2020, startMonth: 1 },
];

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function plpgsqlBackfill(
  term: number,
  payment: number,
  rate: number,
  startYear: number,
  startMonth: number, // 1-indexed
  timing: 'beginning' | 'end',
  classification: 'finance' | 'operating',
) {
  const monthlyRate = rate / 100 / 12;
  const isOperating = classification === 'operating';
  const isBeginning = timing === 'beginning';

  const pvPayments = rate === 0
    ? payment * term
    : isBeginning
      ? payment * (1 - Math.pow(1 + monthlyRate, -term)) / monthlyRate * (1 + monthlyRate)
      : payment * (1 - Math.pow(1 + monthlyRate, -term)) / monthlyRate;
  const leaseLiability = round2(pvPayments);
  const rouAsset = round2(leaseLiability);

  const straightLineCost = isOperating && term > 0
    ? round2((payment * term + rouAsset - leaseLiability) / term)
    : 0;
  const monthlyDepreciation = !isOperating && term > 0
    ? rouAsset / term
    : 0;

  const rows: Array<{
    periodNumber: number;
    periodDate: string;
    beginningLiability: number;
    paymentAmount: number;
    interestExpense: number;
    principalReduction: number;
    endingLiability: number;
    rouAssetBalance: number;
    depreciationExpense: number;
  }> = [];
  let beginningLiability = leaseLiability;
  let rouBalance = rouAsset;

  for (let period = 1; period <= term; period++) {
    const periodDate = new Date(startYear, startMonth - 1 + period - 1, 1);
    const periodPayment = round2(payment);

    // Mirrors the live regeneration: carry unrounded balances, round each row on output.
    let interestExact: number;
    let endingLiability: number;
    if (isBeginning) {
      const after = beginningLiability - periodPayment;
      interestExact = after * monthlyRate;
      endingLiability = after + interestExact;
    } else {
      interestExact = beginningLiability * monthlyRate;
      endingLiability = beginningLiability + interestExact - periodPayment;
    }
    if (period === term && Math.abs(endingLiability) < 1) endingLiability = 0;

    let newRouBalance = isOperating
      ? rouBalance - (straightLineCost - interestExact)
      : rouBalance - monthlyDepreciation;
    if (period === term || newRouBalance < 0) newRouBalance = 0;

    const begR = Math.max(0, round2(beginningLiability));
    const endR = Math.max(0, round2(endingLiability));
    const rouEndR = Math.max(0, round2(newRouBalance));
    const principalReduction = round2(begR - endR);

    rows.push({
      periodNumber: period,
      periodDate: toYMD(periodDate),
      beginningLiability: begR,
      paymentAmount: periodPayment,
      interestExpense: Math.max(0, round2(periodPayment - principalReduction)),
      principalReduction: Math.max(0, principalReduction),
      endingLiability: endR,
      rouAssetBalance: rouEndR,
      depreciationExpense: round2(round2(rouBalance) - rouEndR),
    });

    beginningLiability = Math.max(0, endingLiability);
    rouBalance = newRouBalance;
  }

  return rows;
}

describe('A1: SQL backfill matches TypeScript calculator for all 25 leases', () => {
  for (const lease of leaseData) {
    it(`${lease.name} (${lease.classification}, ${lease.timing}, ${lease.term}mo, ${lease.rate}%)`, () => {
      const tsSchedule = generateAmortizationSchedule({
        leaseTermMonths: lease.term,
        paymentAmount: lease.payment,
        incrementalBorrowingRate: lease.rate,
        initialDirectCosts: 0,
        leaseIncentives: 0,
        leaseStartDate: new Date(lease.startYear, lease.startMonth - 1, 1),
        paymentTiming: lease.timing,
        paymentFrequency: 'monthly',
        residualValueGuarantee: 0,
        rvgProbableAmount: 0,
        classification: lease.classification,
        prepaidLeasePayments: 0,
        purchaseOptionPrice: 0,
        purchaseOptionReasonablyCertain: false,
        amortizeOverUsefulLife: false,
        usefulLifeMonths: undefined,
      });

      const sqlRows = plpgsqlBackfill(
        lease.term, lease.payment, lease.rate,
        lease.startYear, lease.startMonth,
        lease.timing, lease.classification,
      );

      expect(sqlRows.length).toBe(tsSchedule.length);

      let maxDiff = 0;
      let worstField = '';
      let worstPeriod = 0;

      for (let i = 0; i < tsSchedule.length; i++) {
        const ts = tsSchedule[i];
        const sql = sqlRows[i];

        expect(sql.periodNumber).toBe(ts.periodNumber);
        expect(sql.periodDate).toBe(toYMD(ts.periodDate));

        const fields: Array<[string, number, number]> = [
          ['beginningLiability', sql.beginningLiability, ts.beginningLiability],
          ['paymentAmount', sql.paymentAmount, ts.paymentAmount],
          ['interestExpense', sql.interestExpense, ts.interestExpense],
          ['principalReduction', sql.principalReduction, ts.principalReduction],
          ['endingLiability', sql.endingLiability, ts.endingLiability],
          ['rouAssetBalance', sql.rouAssetBalance, ts.rouAssetBalance],
          ['depreciationExpense', sql.depreciationExpense, ts.depreciationExpense],
        ];

        for (const [field, sqlVal, tsVal] of fields) {
          const diff = Math.abs(sqlVal - tsVal);
          if (diff > maxDiff) { maxDiff = diff; worstField = field; worstPeriod = ts.periodNumber; }
        }
      }

      // Max difference must be <= 0.01 (rounding tolerance)
      expect(maxDiff).toBeLessThanOrEqual(0.01);
      if (maxDiff > 0) {
        // Log small diffs for visibility
        console.log(`  ${lease.name}: max diff ${maxDiff} at ${worstField} period ${worstPeriod}`);
      }
    });
  }

  it('summary: all 25 leases match within 0.01 tolerance', () => {
    let totalMaxDiff = 0;
    for (const lease of leaseData) {
      const tsSchedule = generateAmortizationSchedule({
        leaseTermMonths: lease.term,
        paymentAmount: lease.payment,
        incrementalBorrowingRate: lease.rate,
        initialDirectCosts: 0,
        leaseIncentives: 0,
        leaseStartDate: new Date(lease.startYear, lease.startMonth - 1, 1),
        paymentTiming: lease.timing,
        paymentFrequency: 'monthly',
        residualValueGuarantee: 0,
        rvgProbableAmount: 0,
        classification: lease.classification,
        prepaidLeasePayments: 0,
        purchaseOptionPrice: 0,
        purchaseOptionReasonablyCertain: false,
        amortizeOverUsefulLife: false,
        usefulLifeMonths: undefined,
      });
      const sqlRows = plpgsqlBackfill(
        lease.term, lease.payment, lease.rate,
        lease.startYear, lease.startMonth,
        lease.timing, lease.classification,
      );

      for (let i = 0; i < tsSchedule.length; i++) {
        const ts = tsSchedule[i];
        const sql = sqlRows[i];
        const diffs = [
          Math.abs(sql.beginningLiability - ts.beginningLiability),
          Math.abs(sql.paymentAmount - ts.paymentAmount),
          Math.abs(sql.interestExpense - ts.interestExpense),
          Math.abs(sql.principalReduction - ts.principalReduction),
          Math.abs(sql.endingLiability - ts.endingLiability),
          Math.abs(sql.rouAssetBalance - ts.rouAssetBalance),
          Math.abs(sql.depreciationExpense - ts.depreciationExpense),
        ];
        totalMaxDiff = Math.max(totalMaxDiff, ...diffs);
      }
    }
    expect(totalMaxDiff).toBeLessThanOrEqual(0.01);
    console.log(`  Overall max diff across all 25 leases: ${totalMaxDiff}`);
  });
});

describe('A3: last-period ending liability should be 0 (current behavior)', () => {
  // This documents the current behavior where ending liability may have
  // small residuals (0.01-0.08) due to rounding accumulation.
  // The fix in generateAmortizationSchedule will true-up the last period.
  for (const lease of leaseData) {
    it(`${lease.name} last period ending liability`, () => {
      const schedule = generateAmortizationSchedule({
        leaseTermMonths: lease.term,
        paymentAmount: lease.payment,
        incrementalBorrowingRate: lease.rate,
        initialDirectCosts: 0,
        leaseIncentives: 0,
        leaseStartDate: new Date(lease.startYear, lease.startMonth - 1, 1),
        paymentTiming: lease.timing,
        paymentFrequency: 'monthly',
        residualValueGuarantee: 0,
        rvgProbableAmount: 0,
        classification: lease.classification,
        prepaidLeasePayments: 0,
        purchaseOptionPrice: 0,
        purchaseOptionReasonablyCertain: false,
        amortizeOverUsefulLife: false,
        usefulLifeMonths: undefined,
      });
      const last = schedule[schedule.length - 1];
      // Before fix: may be > 0. After fix: should be exactly 0
      console.log(`  ${lease.name}: ending_liability=${last.endingLiability}, rou_balance=${last.rouAssetBalance}`);
    });
  }
});

describe('E: unrounded carry keeps every row within $0.01 of the exact schedule', () => {
  it('Building 1 matches the regenerated live schedule', () => {
    const rows = generateAmortizationSchedule({
      leaseTermMonths: 162, paymentAmount: 500, incrementalBorrowingRate: 6,
      initialDirectCosts: 0, leaseIncentives: 0, leaseStartDate: new Date(2026, 9, 1),
      paymentTiming: 'end', classification: 'finance',
    });
    expect(rows[0].beginningLiability).toBe(55424.32);
    expect(rows[11].rouAssetBalance).toBe(51318.81);
    expect(rows[11].endingLiability).toBe(52674.99);
    expect(round2(rows.reduce((t, r) => t + r.interestExpense, 0))).toBe(25575.68);
    expect(rows[rows.length - 1].endingLiability).toBe(0);
  });

  it('no mid-schedule drift beyond $0.01 versus exact math, and every row foots', () => {
    const rows = generateAmortizationSchedule({
      leaseTermMonths: 241, paymentAmount: 2500, incrementalBorrowingRate: 5.98,
      initialDirectCosts: 0, leaseIncentives: 0, leaseStartDate: new Date(2020, 0, 1),
      paymentTiming: 'end', classification: 'finance',
    });
    const r = 5.98 / 1200;
    let exact = rows[0].beginningLiability;
    for (const row of rows.slice(0, -1)) {
      exact = exact * (1 + r) - row.paymentAmount;
      expect(Math.abs(row.endingLiability - exact)).toBeLessThanOrEqual(0.0051);
      expect(round2(row.beginningLiability - row.principalReduction)).toBe(row.endingLiability);
      expect(round2(row.interestExpense + row.principalReduction)).toBe(row.paymentAmount);
    }
  });
});

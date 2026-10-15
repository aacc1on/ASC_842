import { describe, it, expect } from 'vitest';
import { calculateLeaseMetrics, generateAmortizationSchedule } from '../utils/leaseCalculations';
import { determineLeaseClassification } from '../utils/leaseClassification';

describe('Lease classification validation', () => {
  it('classifies as finance when ownership transfers', () => {
    const result = determineLeaseClassification({
      leaseTermMonths: 36,
      assetEconomicLifeMonths: 120,
      presentValue: 36000,
      assetFairValue: 50000,
      transferOwnership: true,
      purchaseOption: false,
      purchaseOptionReasonablyCertain: false,
      purchaseOptionPrice: 0,
      specializedAsset: false,
    });
    expect(result.classification).toBe('finance');
    expect(result.tests.transferOwnership).toBe(true);
  });

  it('classifies as operating when no criteria met', () => {
    const result = determineLeaseClassification({
      leaseTermMonths: 12,
      assetEconomicLifeMonths: 240,
      presentValue: 12000,
      assetFairValue: 500000,
      transferOwnership: false,
      purchaseOption: false,
      purchaseOptionReasonablyCertain: false,
      purchaseOptionPrice: 0,
      specializedAsset: false,
    });
    expect(result.classification).toBe('operating');
  });

  it('classifies as finance when specialized asset', () => {
    const result = determineLeaseClassification({
      leaseTermMonths: 12,
      assetEconomicLifeMonths: 240,
      presentValue: 12000,
      assetFairValue: 500000,
      transferOwnership: false,
      purchaseOption: false,
      purchaseOptionReasonablyCertain: false,
      purchaseOptionPrice: 0,
      specializedAsset: true,
    });
    expect(result.classification).toBe('finance');
    expect(result.tests.specializedAsset).toBe(true);
  });
});

describe('Lease calculations — valid form payload', () => {
  it('calculateLeaseMetrics produces ROU asset and lease liability', () => {
    const metrics = calculateLeaseMetrics({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 5,
      initialDirectCosts: 500,
      leaseIncentives: 200,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    expect(metrics.rouAsset).toBeGreaterThan(0);
    expect(metrics.leaseLiability).toBeGreaterThan(0);
    expect(metrics.rouAsset).toBeCloseTo(metrics.leaseLiability + 500 - 200, 0);
  });

  it('generateAmortizationSchedule produces 12 rows for a 12-month lease', () => {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 5,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    expect(schedule).toHaveLength(12);
  });

  it('operating lease schedule has consistent straight-line cost', () => {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 5,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    const totalCost = schedule.reduce((s, r) => s + r.interestExpense + r.depreciationExpense, 0);
    const expectedCost = 1000 * 12;
    expect(Math.abs(totalCost - expectedCost)).toBeLessThan(1);
  });

  it('finance lease schedule has interest + depreciation', () => {
    const schedule = generateAmortizationSchedule({
      leaseTermMonths: 12,
      paymentAmount: 1000,
      incrementalBorrowingRate: 5,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'finance',
    });

    expect(schedule.every(r => r.interestExpense >= 0)).toBe(true);
    expect(schedule.every(r => r.depreciationExpense >= 0)).toBe(true);
  });
});

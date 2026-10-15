import { describe, it, expect } from 'vitest';
import { determineLeaseClassification } from './leaseClassification';

const baseInputs = (overrides: Partial<Parameters<typeof determineLeaseClassification>[0]> = {}) => ({
  leaseTermMonths: 36,
  assetEconomicLifeMonths: 60,
  presentValue: 32871.02,
  assetFairValue: 35000,
  transferOwnership: false,
  purchaseOption: false,
  purchaseOptionReasonablyCertain: false,
  purchaseOptionPrice: 0,
  specializedAsset: false,
  ...overrides,
});

describe('determineLeaseClassification', () => {
  it('(8) PV 93.9% of FV $35,000 → FINANCE', () => {
    const result = determineLeaseClassification(baseInputs());
    expect(result.classification).toBe('finance');
    expect(result.tests.substantiallyAllValue).toBe(true);
  });

  it('(8) PV 65.7% of FV $50,000, no other criteria → OPERATING', () => {
    const result = determineLeaseClassification(baseInputs({ assetFairValue: 50000 }));
    expect(result.classification).toBe('operating');
    expect(result.tests.substantiallyAllValue).toBe(false);
  });

  it('(8) transfer of ownership → FINANCE regardless of other tests', () => {
    const result = determineLeaseClassification(baseInputs({
      transferOwnership: true,
      assetFairValue: 50000,
    }));
    expect(result.classification).toBe('finance');
    expect(result.tests.transferOwnership).toBe(true);
  });

  it('major part of life (≥75%) → FINANCE', () => {
    const result = determineLeaseClassification(baseInputs({
      leaseTermMonths: 48,
      assetEconomicLifeMonths: 60,
      assetFairValue: 50000,
    }));
    expect(result.classification).toBe('finance');
    expect(result.tests.majorPartOfLife).toBe(true);
  });

  it('bargain purchase option → FINANCE', () => {
    const result = determineLeaseClassification(baseInputs({
      purchaseOption: true,
      purchaseOptionReasonablyCertain: true,
      purchaseOptionPrice: 1000,
      assetFairValue: 50000,
    }));
    expect(result.classification).toBe('finance');
    expect(result.tests.purchaseOptionReasonablyCertain).toBe(true);
  });

  it('specialized asset → FINANCE', () => {
    const result = determineLeaseClassification(baseInputs({
      specializedAsset: true,
      assetFairValue: 50000,
    }));
    expect(result.classification).toBe('finance');
    expect(result.tests.specializedAsset).toBe(true);
  });

  it('no criteria met → OPERATING with appropriate reason', () => {
    const result = determineLeaseClassification(baseInputs({
      assetFairValue: 50000,
      leaseTermMonths: 12,
      assetEconomicLifeMonths: 120,
    }));
    expect(result.classification).toBe('operating');
    expect(result.reasons).toHaveLength(1);
  });
});

describe('75% economic-life test in whole months', () => {
  const lowValue = { assetFairValue: 1_000_000 };

  it('45 of 60 months (exactly 75%) → FINANCE', () => {
    const result = determineLeaseClassification(baseInputs({ ...lowValue, leaseTermMonths: 45, assetEconomicLifeMonths: 60 }));
    expect(result.tests.majorPartOfLife).toBe(true);
    expect(result.classification).toBe('finance');
  });

  it('44 of 60 months (73.3%) → OPERATING', () => {
    const result = determineLeaseClassification(baseInputs({ ...lowValue, leaseTermMonths: 44, assetEconomicLifeMonths: 60 }));
    expect(result.tests.majorPartOfLife).toBe(false);
    expect(result.classification).toBe('operating');
  });
});

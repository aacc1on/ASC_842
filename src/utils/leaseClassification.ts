export interface ClassificationInputs {
  leaseTermMonths: number;
  assetEconomicLifeMonths: number;
  presentValue: number;
  assetFairValue: number;
  transferOwnership: boolean;
  purchaseOption: boolean;
  purchaseOptionReasonablyCertain: boolean;
  purchaseOptionPrice: number;
  specializedAsset: boolean;
}

export interface ClassificationResult {
  classification: 'operating' | 'finance';
  reasons: string[];
  tests: {
    transferOwnership: boolean;
    purchaseOptionReasonablyCertain: boolean;
    majorPartOfLife: boolean;
    substantiallyAllValue: boolean;
    specializedAsset: boolean;
  };
}

export function determineLeaseClassification(
  inputs: ClassificationInputs
): ClassificationResult {
  const tests = {
    transferOwnership: false,
    purchaseOptionReasonablyCertain: false,
    majorPartOfLife: false,
    substantiallyAllValue: false,
    specializedAsset: false,
  };

  const reasons: string[] = [];

  if (inputs.transferOwnership) {
    tests.transferOwnership = true;
    reasons.push('Lease transfers ownership at end of term');
  }

  if (inputs.purchaseOption && inputs.purchaseOptionReasonablyCertain) {
    tests.purchaseOptionReasonablyCertain = true;
    reasons.push('Purchase option reasonably certain to be exercised');
  }

  if (inputs.leaseTermMonths > 0 && inputs.assetEconomicLifeMonths > 0) {
    const termRatio = inputs.leaseTermMonths / inputs.assetEconomicLifeMonths;
    if (termRatio >= 0.75) {
      tests.majorPartOfLife = true;
      reasons.push(
        `Lease term is ${(termRatio * 100).toFixed(1)}% of economic life (>=75%)`
      );
    }
  }

  if (inputs.presentValue > 0 && inputs.assetFairValue > 0) {
    const pvRatio = inputs.presentValue / inputs.assetFairValue;
    if (pvRatio >= 0.9) {
      tests.substantiallyAllValue = true;
      reasons.push(
        `Present value is ${(pvRatio * 100).toFixed(1)}% of fair value (>=90%)`
      );
    }
  }

  if (inputs.specializedAsset) {
    tests.specializedAsset = true;
    reasons.push('Asset has no alternative use to lessor at end of term');
  }

  const isFinanceLease =
    tests.transferOwnership ||
    tests.purchaseOptionReasonablyCertain ||
    tests.majorPartOfLife ||
    tests.substantiallyAllValue ||
    tests.specializedAsset;

  return {
    classification: isFinanceLease ? 'finance' : 'operating',
    reasons: isFinanceLease
      ? reasons
      : ['Does not meet any of the five finance lease criteria'],
    tests,
  };
}

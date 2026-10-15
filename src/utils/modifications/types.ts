

export interface ScheduleRow {
  period_number: number;
  period_date: string;
  beginning_liability: number;
  payment_amount: number;
  interest_expense: number;
  principal_reduction: number;
  ending_liability: number;
  rou_asset_balance: number;
  depreciation_expense: number;
}

export interface CarryingAmounts {
  rouAsset: number;
  leaseLiability: number;
  periodsCompleted: number;
}

export interface ModificationResult {
  oldRouAsset: number;
  oldLiability: number;
  newRouAsset: number;
  newLiability: number;
  liabilityChange: number;
  rouChange: number;
  gainOnModification: number;
  remainingSchedule: ScheduleRow[];
  newLeaseEndDate: string;
  newLeaseTermMonths: number;
}

export interface CancellationResult {
  carryingRouAsset: number;
  carryingLiability: number;
  gainLoss: number;
  isGain: boolean;
}

export interface ComputeModificationOptions {
  classification: 'operating' | 'finance';
  purchaseOptionPrice: number;
  purchaseOptionReasonablyCertain: boolean;
  rvgProbableAmount: number;
  amortizeOverUsefulLife: boolean;
  usefulLifeMonths: number | undefined;
}

export interface TransactionInsert {
  user_id: string;
  lease_id: string;
  modification_id?: string;
  transaction_date: string;
  transaction_type: string;
  description: string;
  account_debited: string;
  account_credited: string;
  amount: number;
  organization_id?: string;
}

export interface ImpairmentResult {
  rouBefore: number;
  impairmentAmount: number;
  rouAfter: number;
  remainingSchedule: ScheduleRow[];
}

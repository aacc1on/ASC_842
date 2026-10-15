export interface StoredScheduleRow {
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

export type StoredScheduleMap = Map<string, StoredScheduleRow[]>;

export interface MonthEndTransaction {
  lease_id: string;
  lease_name: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  reference_number: string;
  period: string;
}

export interface MonthEndResult {
  transactions: MonthEndTransaction[];
  skippedLeases: SkippedLease[];
}

export interface SkippedLease {
  lease_id: string;
  lease_name: string;
  reason: string;
}

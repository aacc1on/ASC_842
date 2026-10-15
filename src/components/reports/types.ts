import { type LeaseBreakdownItem } from '../../utils/financialReports';

export type ComplianceSection = 'classification' | 'disclosures' | 'maturity' | 'checklist' | 'reconciliation';

export interface ActiveBreakdown {
  title: string;
  total: number;
  items: LeaseBreakdownItem[];
  isNegative?: boolean;
}

export interface BranchOption { id: string; branch_name: string; branch_code?: string | null }
export interface AssetTypeOption { id: string; type_name: string; type_code: string }

export type ReportsTab = 'portfolio' | 'financial' | 'compliance' | 'expiration' | 'payment_reminder';
export type FinancialReportKind = 'balance_sheet' | 'profit_loss' | 'cash_flow' | 'transaction_ledger' | 'transaction_by_assets';

import type { UserPermissions, UserRole } from '../../App';

export interface TransactionsViewProps {
  userRole?: UserRole;
  permissions: UserPermissions;
  selectedCompanyId?: string | null;
}

/**
 * A unified transaction row as returned by the `get_filtered_transactions` RPC
 * (which unions the `transactions` and `lease_transactions` tables) and as
 * produced by the in-memory loader for non-server view modes.
 */
export interface Transaction {
  id: string;
  lease_id: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  reference_number: string;
  period: string;
  is_reversed: boolean;
  created_at: string;
  // Joined fields
  lease_name?: string;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  fixed_asset_type_id?: string | null;
  fixed_asset_type_name?: string | null;
  fixed_asset_type_code?: string | null;
  lease_classification?: 'operating' | 'finance' | null;
  month_end_document_id?: string | null;
}

export interface TransactionFormData {
  lease_id: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: string;
  credit_amount: string;
  description: string;
  reference_number: string;
  period: string;
}

export type ViewMode = 'grid' | 'table' | 'kanban' | 'week';

export const isServerViewMode = (mode: ViewMode) => mode === 'grid' || mode === 'table';

export interface DataFilters {
  currentPage: number;
  pageSize: number;
  debouncedSearch: string;
  filterType: string;
  filterPeriod: string;
  customPeriodStart: string;
  customPeriodEnd: string;
  filterFixedAssetType: string;
  filterBranch: string;
  filterLeaseClassification: string;
}

/** Shape returned by the `get_filtered_transactions` RPC. */
export interface ServerTransactionsResponse {
  rows: Transaction[];
  total_count: number;
  total_debits: number;
  total_credits: number;
  debit_summary: Record<string, number>;
  credit_summary: Record<string, number>;
}

export interface AccountSummaryItem {
  account: string;
  total: number;
  count: number;
}

export interface WeeklyGroup {
  weekKey: string;
  weekLabel: string;
  startDate: Date;
  endDate: Date;
  transactions: Transaction[];
  totalDebits: number;
  totalCredits: number;
}

export type TransactionSection = 'debits' | 'credits';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import type { Branch, Lease } from '../types/lease';
import type {
  DataFilters,
  ServerTransactionsResponse,
  Transaction,
  ViewMode,
} from '../components/transactions/types';
import { isServerViewMode } from '../components/transactions/types';
import { fetchAll, fetchAllIn } from '../utils/fetchAll';
import { currentOrgId } from '../utils/currentOrg';

interface UseTransactionsDataResult {
  transactions: Transaction[];
  serverRows: Transaction[];
  serverTotalCount: number;
  leases: Lease[];
  branches: Branch[];
  loading: boolean;
  error: string | null;
  refreshData: () => void;
}

interface FetchedLeaseRow {
  id: string;
  user_id: string;
  branch_id?: string | null;
  company_id?: string | null;
  lease_name: string;
  lease_description: string;
  lessor_name: string;
  lessor_type: 'corporate' | 'individual' | 'government' | 'financial_institution' | 'other';
  lease_start_date: string;
  lease_end_date: string;
  lease_term_months: number;
  payment_amount: number;
  payment_frequency: string;
  incremental_borrowing_rate: number;
  lease_classification: 'operating' | 'finance';
  initial_direct_costs: number;
  lease_incentives: number;
  rou_asset: number | null;
  lease_liability: number | null;
  status: 'active' | 'terminated' | 'expired' | 'cancelled' | 'pending';
  payment_timing: 'beginning' | 'end';
  transfer_ownership: boolean;
  purchase_option: boolean;
  purchase_option_price: number;
  asset_fair_value: number;
  asset_market_value: number;
  asset_economic_life_months: number;
  specialized_asset: boolean;
  residual_value_guarantee: number;
  auto_classified: boolean;
  fixed_asset_type_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface RawTransactionRow {
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
  lease_name?: string;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  fixed_asset_type_id?: string | null;
  fixed_asset_type_name?: string | null;
  fixed_asset_type_code?: string | null;
  lease_classification?: 'operating' | 'finance' | null;
  month_end_document_id?: string | null;
  leases?: { lease_name?: string; company_id?: string | null; branch_id?: string | null; lease_classification?: 'operating' | 'finance' | null } | null;
}

const RPC_NAME = 'get_filtered_transactions';

/**
 * Loads leases + branches once (refreshable), and transactions per the active
 * view mode. In grid/server mode it calls the `get_filtered_transactions` RPC
 * for paginated, filtered rows + a total count. In week/kanban mode it loads
 * the full filtered set into memory so grouping/kanban columns work client-side.
 *
 * Args are positional to match how TransactionsView invokes the hook:
 * `(viewMode, dataFilters, selectedCompanyId)`.
 */
export function useTransactionsData(
  viewMode: ViewMode,
  dataFilters: DataFilters,
  selectedCompanyId?: string | null,
): UseTransactionsDataResult {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [serverRows, setServerRows] = useState<Transaction[]>([]);
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refError, setRefError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refreshData = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load leases + branches once and on manual refresh.
  useEffect(() => {
    let cancelled = false;

    async function loadRefData() {
      setRefError(null);
      let leaseRows: FetchedLeaseRow[];
      let orgId: string;
      try {
        orgId = await currentOrgId();
        leaseRows = await fetchAll<FetchedLeaseRow>('leases', (from, to) => supabase
          .from('leases')
          .select('*')
          .eq('organization_id', orgId)
          .order('lease_name')
          .order('id')
          .range(from, to));
      } catch (err) {
        if (cancelled) return;
        setLeases([]);
        setRefError(toUserMessage(err, 'Failed to load leases.'));
        return;
      }
      if (cancelled) return;
      if (selectedCompanyId) {
        leaseRows = leaseRows.filter((l) => l.company_id === selectedCompanyId);
      }
      setLeases(leaseRows as unknown as Lease[]);

      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .select('*')
        .eq('organization_id', orgId)
        .order('branch_name');
      if (cancelled) return;
      setBranches((branchData ?? []) as unknown as Branch[]);
      if (branchError) setRefError(toUserMessage(branchError, 'Failed to load branches.'));
    }

    loadRefData();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, refreshKey]);

  // Load transactions.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const orgId = await currentOrgId();
        const leaseIds = leases.map((l) => l.id);

        if (isServerViewMode(viewMode)) {
          // Server-side paginated/filtered load via RPC.
          const isCustom = dataFilters.filterPeriod === 'custom';
          const branchId =
            dataFilters.filterBranch && dataFilters.filterBranch !== 'all' && dataFilters.filterBranch !== 'none'
              ? dataFilters.filterBranch
              : null;
          const assetTypeId =
            dataFilters.filterFixedAssetType &&
            dataFilters.filterFixedAssetType !== 'all' &&
            dataFilters.filterFixedAssetType !== 'none'
              ? dataFilters.filterFixedAssetType
              : null;

          const { data, error } = await supabase.rpc(RPC_NAME, {
            p_page: dataFilters.currentPage,
            p_page_size: dataFilters.pageSize,
            p_search: dataFilters.debouncedSearch ?? '',
            p_type: dataFilters.filterType || 'all',
            p_period: dataFilters.filterPeriod || 'all',
            p_period_start: isCustom && dataFilters.customPeriodStart ? dataFilters.customPeriodStart : null,
            p_period_end: isCustom && dataFilters.customPeriodEnd ? dataFilters.customPeriodEnd : null,
            p_branch_id: branchId,
            p_branch_filter: dataFilters.filterBranch || 'all',
            p_asset_type_id: assetTypeId,
            p_asset_type_filter: dataFilters.filterFixedAssetType || 'all',
            p_lease_classification: dataFilters.filterLeaseClassification || 'all',
          });

          if (cancelled || requestId !== requestIdRef.current) return;
          if (error || !data) {
            setServerRows([]);
            setServerTotalCount(0);
            setTransactions([]);
            return;
          }
          const resp = data as ServerTransactionsResponse;
          const rows: Transaction[] = Array.isArray(resp.rows) ? resp.rows : [];
          setServerRows(rows);
          setServerTotalCount(Number(resp.total_count ?? 0));
          setTransactions(rows);
        } else {
          // Full in-memory load for week/kanban (needs all matching rows).
          if (leaseIds.length === 0) {
            setTransactions([]);
            setServerRows([]);
            setServerTotalCount(0);
            return;
          }

          const select = `*, leases:lease_id (lease_name, company_id, branch_id, fixed_asset_type_id, lease_classification)`;
          // Combine `transactions` (month-end / manual) and `lease_transactions`
          // (initial recognition / derecognition), mirroring the RPC union.
          const [posted, events] = await Promise.all([
            fetchAllIn<RawTransactionRow>('transactions', leaseIds, (batch, from, to) => supabase
              .from('transactions')
              .select(select)
              .eq('organization_id', orgId)
              .in('lease_id', batch)
              .order('transaction_date', { ascending: false })
              .order('id', { ascending: true })
              .range(from, to)),
            fetchAllIn<RawTransactionRow>('lease transactions', leaseIds, (batch, from, to) => supabase
              .from('lease_transactions')
              .select(select)
              .eq('organization_id', orgId)
              .in('lease_id', batch)
              .order('transaction_date', { ascending: false })
              .order('id', { ascending: true })
              .range(from, to)),
          ]);
          if (cancelled || requestId !== requestIdRef.current) return;
          const inCompany = (r: RawTransactionRow) => !selectedCompanyId || r.leases?.company_id === selectedCompanyId;
          const allRows: Transaction[] = [
            ...posted.filter(inCompany).map((r) => normalizeRow(r, r.leases?.lease_name)),
            ...events.filter(inCompany).map((r) => normalizeLeaseTxRow(r, r.leases?.lease_name)),
          ];

          allRows.sort((a, b) =>
            a.transaction_date < b.transaction_date ? 1 : a.transaction_date > b.transaction_date ? -1 : 0,
          );
          setTransactions(allRows);
          setServerRows([]);
          setServerTotalCount(0);
        }
      } catch (err) {
        if (!cancelled && requestId === requestIdRef.current) {
          setTransactions([]);
          setServerRows([]);
          setServerTotalCount(0);
          setLoadError(toUserMessage(err, 'Failed to load transactions.'));
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    viewMode,
    dataFilters.currentPage,
    dataFilters.pageSize,
    dataFilters.debouncedSearch,
    dataFilters.filterType,
    dataFilters.filterPeriod,
    dataFilters.customPeriodStart,
    dataFilters.customPeriodEnd,
    dataFilters.filterFixedAssetType,
    dataFilters.filterBranch,
    dataFilters.filterLeaseClassification,
    leases,
    selectedCompanyId,
    refreshKey,
  ]);

  return {
    transactions,
    serverRows,
    serverTotalCount,
    leases,
    branches,
    loading,
    error: refError ?? loadError,
    refreshData,
  };
}

function normalizeRow(r: RawTransactionRow, leaseName?: string): Transaction {
  return {
    id: r.id,
    lease_id: r.lease_id,
    transaction_date: r.transaction_date,
    transaction_type: r.transaction_type,
    account_debited: r.account_debited,
    account_credited: r.account_credited,
    debit_amount: Number(r.debit_amount ?? 0),
    credit_amount: Number(r.credit_amount ?? 0),
    description: r.description ?? '',
    reference_number: r.reference_number ?? '',
    period: r.period ?? '',
    is_reversed: Boolean(r.is_reversed),
    created_at: r.created_at ?? '',
    lease_name: leaseName ?? r.lease_name ?? undefined,
    branch_id: r.branch_id ?? r.leases?.branch_id ?? null,
    fixed_asset_type_id: r.fixed_asset_type_id ?? r.leases?.branch_id ?? null,
    lease_classification: r.lease_classification ?? r.leases?.lease_classification ?? null,
    month_end_document_id: r.month_end_document_id ?? null,
  };
}

function normalizeLeaseTxRow(r: RawTransactionRow, leaseName?: string): Transaction {
  const amount = Number((r as unknown as { amount?: number }).amount ?? r.debit_amount ?? 0);
  return {
    id: r.id,
    lease_id: r.lease_id,
    transaction_date: r.transaction_date,
    transaction_type: r.transaction_type,
    account_debited: r.account_debited,
    account_credited: r.account_credited,
    debit_amount: amount,
    credit_amount: amount,
    description: r.description ?? '',
    reference_number: 'N/A',
    period: (r.transaction_date ?? '').slice(0, 7),
    is_reversed: false,
    created_at: r.created_at ?? '',
    lease_name: leaseName ?? r.lease_name ?? undefined,
    branch_id: r.branch_id ?? r.leases?.branch_id ?? null,
    fixed_asset_type_id: r.fixed_asset_type_id ?? null,
    lease_classification: r.lease_classification ?? r.leases?.lease_classification ?? null,
    month_end_document_id: null,
  };
}

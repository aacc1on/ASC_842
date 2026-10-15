import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../components/transactions/types';

export interface TransactionFilterState {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  debouncedSearch: string;
  filterType: string;
  setFilterType: (v: string) => void;
  filterPeriod: string;
  setFilterPeriod: (v: string) => void;
  filterFixedAssetType: string;
  setFilterFixedAssetType: (v: string) => void;
  filterBranch: string;
  setFilterBranch: (v: string) => void;
  filterLeaseClassification: string;
  setFilterLeaseClassification: (v: string) => void;
  customPeriodStart: string;
  setCustomPeriodStart: (v: string) => void;
  customPeriodEnd: string;
  setCustomPeriodEnd: (v: string) => void;
}

/**
 * Owns the raw filter inputs (search, type, period, asset type, branch,
 * lease classification,
 * custom range) and a debounced copy of the search query used for server calls.
 */
export function useTransactionFilterState(): TransactionFilterState {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterFixedAssetType, setFilterFixedAssetType] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterLeaseClassification, setFilterLeaseClassification] = useState('all');
  const [customPeriodStart, setCustomPeriodStart] = useState('');
  const [customPeriodEnd, setCustomPeriodEnd] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    filterType,
    setFilterType,
    filterPeriod,
    setFilterPeriod,
    filterFixedAssetType,
    setFilterFixedAssetType,
    filterBranch,
    setFilterBranch,
    filterLeaseClassification,
    setFilterLeaseClassification,
    customPeriodStart,
    setCustomPeriodStart,
    customPeriodEnd,
    setCustomPeriodEnd,
  };
}

interface UseTransactionFiltersResult {
  uniquePeriods: string[];
  uniqueFixedAssetTypes: string[];
  filteredTransactions: Transaction[];
}

/**
 * Derives unique period / asset-type option lists and the filtered transaction
 * set from the loaded `transactions` using the current filter state.
 *
 * In server (grid) mode the transactions array is only the current page, so
 * the derived lists are best-effort and filtering is a no-op pass-through —
 * the server already filtered. In week/kanban mode `transactions` is the full
 * set, so all filters apply here.
 */
export function useTransactionFilters(
  transactions: Transaction[],
  filterState: TransactionFilterState,
): UseTransactionFiltersResult {
  const {
    searchQuery,
    filterType,
    filterPeriod,
    filterFixedAssetType,
    filterBranch,
    filterLeaseClassification,
    customPeriodStart,
    customPeriodEnd,
  } = filterState;

  const uniquePeriods = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.period) set.add(t.period);
    }
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const uniqueFixedAssetTypes = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      const name = t.fixed_asset_type_name;
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((t) => {
      if (q) {
        const hay = [
          t.description,
          t.account_debited,
          t.account_credited,
          t.reference_number,
          t.lease_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterType !== 'all' && t.transaction_type !== filterType) return false;

      if (filterPeriod !== 'all') {
        if (filterPeriod === 'custom') {
          if (customPeriodStart && t.transaction_date < customPeriodStart) return false;
          if (customPeriodEnd && t.transaction_date > customPeriodEnd) return false;
        } else if (t.period !== filterPeriod) {
          return false;
        }
      }

      if (filterFixedAssetType !== 'all') {
        if (filterFixedAssetType === 'none') {
          if (t.fixed_asset_type_id) return false;
        } else if (t.fixed_asset_type_id !== filterFixedAssetType && t.fixed_asset_type_name !== filterFixedAssetType) {
          return false;
        }
      }

      if (filterBranch !== 'all') {
        if (filterBranch === 'none') {
          if (t.branch_id) return false;
        } else if (t.branch_id !== filterBranch) {
          return false;
        }
      }

      if (filterLeaseClassification !== 'all' && t.lease_classification !== filterLeaseClassification) return false;

      return true;
    });
  }, [
    transactions,
    searchQuery,
    filterType,
    filterPeriod,
    filterFixedAssetType,
    filterBranch,
    filterLeaseClassification,
    customPeriodStart,
    customPeriodEnd,
  ]);

  return { uniquePeriods, uniqueFixedAssetTypes, filteredTransactions };
}

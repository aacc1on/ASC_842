import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Transaction } from '../components/transactions/types';
import { useTransactionFilterState, useTransactionFilters, type TransactionFilterState } from './useTransactionFilters';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', lease_id: 'L1', transaction_date: '2026-01-15', transaction_type: 'payment',
  account_debited: 'Lease Liability', account_credited: 'Cash', debit_amount: 1, credit_amount: 1,
  description: '', reference_number: '', period: '2026-01', is_reversed: false, created_at: '', ...over,
});

const ROWS: Transaction[] = [
  tx({ id: 'a', description: 'Office rent', period: '2026-01', transaction_date: '2026-01-10', branch_id: 'br-1', fixed_asset_type_id: 'at-1', fixed_asset_type_name: 'Property', lease_classification: 'operating', lease_name: 'HQ' }),
  tx({ id: 'b', transaction_type: 'interest', account_debited: 'Interest Expense', period: '2026-02', transaction_date: '2026-02-10', branch_id: null, fixed_asset_type_id: null, lease_classification: 'finance', reference_number: 'REF-77' }),
  tx({ id: 'c', transaction_type: 'depreciation', period: '2026-03', transaction_date: '2026-03-10', branch_id: 'br-2', fixed_asset_type_id: 'at-2', fixed_asset_type_name: 'Vehicles', lease_classification: 'finance' }),
  tx({ id: 'd', period: '', transaction_date: '2025-12-31', fixed_asset_type_name: 'Property', fixed_asset_type_id: 'at-1' }),
];

const base: TransactionFilterState = {
  searchQuery: '', setSearchQuery: () => undefined, debouncedSearch: '', filterType: 'all', setFilterType: () => undefined,
  filterPeriod: 'all', setFilterPeriod: () => undefined, filterFixedAssetType: 'all', setFilterFixedAssetType: () => undefined,
  filterBranch: 'all', setFilterBranch: () => undefined, filterLeaseClassification: 'all', setFilterLeaseClassification: () => undefined,
  customPeriodStart: '', setCustomPeriodStart: () => undefined, customPeriodEnd: '', setCustomPeriodEnd: () => undefined,
};

const ids = (patch: Partial<TransactionFilterState>, rows = ROWS) =>
  renderHook(() => useTransactionFilters(rows, { ...base, ...patch })).result.current.filteredTransactions.map((t) => t.id);

afterEach(() => vi.useRealTimers());

describe('useTransactionFilterState', () => {
  it('starts with "all" filters and debounces the search query by 300ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransactionFilterState());
    expect(result.current).toMatchObject({
      searchQuery: '', debouncedSearch: '', filterType: 'all', filterPeriod: 'all', filterFixedAssetType: 'all',
      filterBranch: 'all', filterLeaseClassification: 'all', customPeriodStart: '', customPeriodEnd: '',
    });
    act(() => result.current.setSearchQuery('ren'));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.setSearchQuery('rent'));
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current.debouncedSearch).toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.debouncedSearch).toBe('rent');
  });

  it('exposes setters for every filter', () => {
    const { result } = renderHook(() => useTransactionFilterState());
    act(() => {
      result.current.setFilterType('interest');
      result.current.setFilterPeriod('custom');
      result.current.setFilterFixedAssetType('at-1');
      result.current.setFilterBranch('none');
      result.current.setFilterLeaseClassification('finance');
      result.current.setCustomPeriodStart('2026-01-01');
      result.current.setCustomPeriodEnd('2026-01-31');
    });
    expect(result.current).toMatchObject({
      filterType: 'interest', filterPeriod: 'custom', filterFixedAssetType: 'at-1', filterBranch: 'none',
      filterLeaseClassification: 'finance', customPeriodStart: '2026-01-01', customPeriodEnd: '2026-01-31',
    });
  });
});

describe('useTransactionFilters', () => {
  it('derives unique periods (newest first) and asset type names', () => {
    const { result } = renderHook(() => useTransactionFilters(ROWS, base));
    expect(result.current.uniquePeriods).toEqual(['2026-03', '2026-02', '2026-01']);
    expect(result.current.uniqueFixedAssetTypes).toEqual(['Property', 'Vehicles']);
    expect(result.current.filteredTransactions).toHaveLength(4);
  });

  it('handles empty input', () => {
    const { result } = renderHook(() => useTransactionFilters([], { ...base, searchQuery: 'x' }));
    expect(result.current).toEqual({ uniquePeriods: [], uniqueFixedAssetTypes: [], filteredTransactions: [] });
  });

  it('searches description, accounts, reference and lease name case-insensitively', () => {
    expect(ids({ searchQuery: '  OFFICE ' })).toEqual(['a']);
    expect(ids({ searchQuery: 'interest exp' })).toEqual(['b']);
    expect(ids({ searchQuery: 'ref-77' })).toEqual(['b']);
    expect(ids({ searchQuery: 'hq' })).toEqual(['a']);
    expect(ids({ searchQuery: 'nomatch' })).toEqual([]);
  });

  it('filters by type and by period', () => {
    expect(ids({ filterType: 'depreciation' })).toEqual(['c']);
    expect(ids({ filterPeriod: '2026-02' })).toEqual(['b']);
  });

  it('applies custom period bounds independently', () => {
    expect(ids({ filterPeriod: 'custom', customPeriodStart: '2026-02-01' })).toEqual(['b', 'c']);
    expect(ids({ filterPeriod: 'custom', customPeriodEnd: '2026-01-31' })).toEqual(['a', 'd']);
    expect(ids({ filterPeriod: 'custom', customPeriodStart: '2026-01-01', customPeriodEnd: '2026-02-28' })).toEqual(['a', 'b']);
    expect(ids({ filterPeriod: 'custom' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by fixed asset type id, name, or none', () => {
    expect(ids({ filterFixedAssetType: 'at-2' })).toEqual(['c']);
    expect(ids({ filterFixedAssetType: 'Property' })).toEqual(['a', 'd']);
    expect(ids({ filterFixedAssetType: 'none' })).toEqual(['b']);
  });

  it('filters by branch id or none', () => {
    expect(ids({ filterBranch: 'br-2' })).toEqual(['c']);
    expect(ids({ filterBranch: 'none' })).toEqual(['b', 'd']);
  });

  it('filters by lease classification and combines filters', () => {
    expect(ids({ filterLeaseClassification: 'finance' })).toEqual(['b', 'c']);
    expect(ids({ filterLeaseClassification: 'finance', filterBranch: 'br-2', filterType: 'depreciation' })).toEqual(['c']);
  });
});

import { Search, X } from 'lucide-react';
import type { LeaseStatusFilter } from '../../utils/leaseLifecycle';
import type { LeaseListScope } from './leaseScope';
import type { BucketTotals } from '../../utils/portfolioTotals';
import { formatCurrency } from '../../utils/formatting';

export type { LeaseListScope } from './leaseScope';

interface LeaseFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filterLeaseType: 'all' | 'operating' | 'finance';
  filterLessorType: string;
  filterBranch: string;
  branches: { id: string; branch_name: string; branch_code: string | null }[];
  leasesLength: number;
  totalCount: number;
  scope: LeaseListScope;
  onScopeChange: (scope: LeaseListScope) => void;
  scopeTotals: BucketTotals | null;
  onFilterChange: (
    leaseType: 'all' | 'operating' | 'finance',
    lessorType: string,
    branchId: string
  ) => void;
  onClearFilters: () => void;
}

const LESSOR_TYPES: { value: string; label: string }[] = [
  { value: 'all', label: 'All lessor types' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'individual', label: 'Individual' },
  { value: 'government', label: 'Government' },
  { value: 'financial_institution', label: 'Financial Institution' },
  { value: 'other', label: 'Other' },
];

const selectClass =
  'px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white';

export function LeaseFilters({
  searchQuery,
  onSearchChange,
  filterLeaseType,
  filterLessorType,
  filterBranch,
  branches,
  leasesLength,
  totalCount,
  scope,
  onScopeChange,
  scopeTotals,
  onFilterChange,
  onClearFilters,
}: LeaseFiltersProps) {
  const hasActiveFilters =
    !!searchQuery ||
    filterLeaseType !== 'all' ||
    filterLessorType !== 'all' ||
    filterBranch !== 'all' ||
    scope.status !== 'all' ||
    scope.missingClassificationOnly;

  return (
    <div className="mb-6">
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-500" aria-hidden="true" />
        <label htmlFor="lease-search" className="sr-only">Search leases</label>
        <input
          id="lease-search"
          type="text"
          placeholder="Search by lease name or lessor..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search by lease name or lessor"
          className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      <label htmlFor="filter-lease-type" className="sr-only">Filter by lease type</label>
      <select
        id="filter-lease-type"
        value={filterLeaseType}
        aria-label="Filter by lease type"
        onChange={(e) =>
          onFilterChange(e.target.value as 'all' | 'operating' | 'finance', filterLessorType, filterBranch)
        }
        className={selectClass}
      >
        <option value="all">All types</option>
        <option value="operating">Operating</option>
        <option value="finance">Finance</option>
      </select>

      <label htmlFor="filter-lease-status" className="sr-only">Filter by lease status</label>
      <select
        id="filter-lease-status"
        value={scope.status}
        aria-label="Filter by lease status"
        onChange={(e) => onScopeChange({ ...scope, status: e.target.value as LeaseStatusFilter })}
        className={selectClass}
      >
        <option value="all">All statuses</option>
        <option value="active">Active (in term today)</option>
        <option value="not_started">Not started</option>
        <option value="ended">Ended</option>
      </select>

      <label htmlFor="filter-lessor-type" className="sr-only">Filter by lessor type</label>
      <select
        id="filter-lessor-type"
        value={filterLessorType}
        aria-label="Filter by lessor type"
        onChange={(e) => onFilterChange(filterLeaseType, e.target.value, filterBranch)}
        className={selectClass}
      >
        {LESSOR_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <label htmlFor="filter-branch" className="sr-only">Filter by branch</label>
      <select
        id="filter-branch"
        value={filterBranch}
        aria-label="Filter by branch"
        onChange={(e) => onFilterChange(filterLeaseType, filterLessorType, e.target.value)}
        className={selectClass}
      >
        <option value="all">All branches</option>
        <option value="none">No branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.branch_name}
            {b.branch_code ? ` (${b.branch_code})` : ''}
          </option>
        ))}
      </select>

      <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={scope.missingClassificationOnly}
          onChange={(e) => onScopeChange({ ...scope, missingClassificationOnly: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
        />
        Missing classification data
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
        >
          <X className="w-4 h-4" />
          Clear
        </button>
      )}

      <span className="text-xs text-slate-500 sm:ml-auto">
        Showing {leasesLength} of {totalCount}
      </span>
    </div>
    {scopeTotals && (
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600" data-testid="lease-scope-totals">
        <span><span className="font-semibold text-slate-900">{scopeTotals.count}</span> leases in selection</span>
        <span>ROU asset <span className="font-semibold text-slate-900">{formatCurrency(scopeTotals.rou)}</span></span>
        <span>Lease liability <span className="font-semibold text-slate-900">{formatCurrency(scopeTotals.liability)}</span></span>
      </div>
    )}
    </div>
  );
}

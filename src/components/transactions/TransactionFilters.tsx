import { Download } from 'lucide-react';
import { DateRangeFilter } from '../DateRangeFilter';
import type { Branch } from '../../types/lease';

interface TransactionFiltersProps {
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
  uniquePeriods: string[];
  uniqueFixedAssetTypes: string[];
  branches: Branch[];
  filteredCount: number;
  onDownloadExcel: () => void;
}

export function TransactionFilters({
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
  uniquePeriods,
  uniqueFixedAssetTypes,
  branches,
  filteredCount,
  onDownloadExcel,
}: TransactionFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-4 mb-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-period" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Period</label>
        <select
          id="filter-period"
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="all">All Periods</option>
          <option value="custom">Custom range…</option>
          {uniquePeriods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {filterPeriod === 'custom' && (
        <DateRangeFilter
          from={customPeriodStart}
          to={customPeriodEnd}
          onApply={(from, to) => {
            setCustomPeriodStart(from);
            setCustomPeriodEnd(to);
          }}
        />
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-asset-type" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Asset Type</label>
        <select
          id="filter-asset-type"
          value={filterFixedAssetType}
          onChange={(e) => setFilterFixedAssetType(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="all">All Asset Types</option>
          <option value="none">Unassigned</option>
          {uniqueFixedAssetTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-branch-tx" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Branch</label>
        <select
          id="filter-branch-tx"
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="all">All Branches</option>
          <option value="none">Unassigned</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-lease-classification" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Lease Classification</label>
        <select
          id="filter-lease-classification"
          value={filterLeaseClassification}
          onChange={(e) => setFilterLeaseClassification(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="all">All Lease Classifications</option>
          <option value="operating">Operational Lease</option>
          <option value="finance">Financial Lease</option>
        </select>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{filteredCount}</span> shown
        </span>
        <button
          onClick={onDownloadExcel}
          disabled={filteredCount === 0}
          className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>
    </div>
  );
}

import { type BranchOption, type AssetTypeOption } from '../types';
import { type Lease } from '../../../types/lease';

import { DEFAULT_REPORT_FILTERS, type ReportFilterState } from '../../../utils/reports/portfolio';

export function ReportFilters({
  leases,
  branchOptions,
  assetTypeOptions,
  filters,
  onChange,
}: {
  leases: Lease[];
  branchOptions: BranchOption[];
  assetTypeOptions: AssetTypeOption[];
  filters: ReportFilterState;
  onChange: (f: ReportFilterState) => void;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-4 -mt-2">
      <div className="flex-1 min-w-[220px]">
        <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Lease Name</label>
        <select
          value={filters.leaseName}
          onChange={(e) => onChange({ ...filters, leaseName: e.target.value })}
          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm"
        >
          <option value="">All Leases</option>
          {leases.map((l) => (
            <option key={l.id} value={l.id}>
              {l.lease_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[220px]">
        <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Fixed Asset Type</label>
        <select
          value={filters.assetType}
          onChange={(e) => onChange({ ...filters, assetType: e.target.value })}
          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm"
        >
          <option value="all">All Asset Types</option>
          <option value="none">Unassigned</option>
          {assetTypeOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.type_name}{t.type_code ? ` (${t.type_code})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[220px]">
        <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Branch</label>
        <select
          value={filters.branch}
          onChange={(e) => onChange({ ...filters, branch: e.target.value })}
          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm"
        >
          <option value="all">All Branches</option>
          <option value="none">No Branch</option>
          {branchOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}{b.branch_code ? ` (${b.branch_code})` : ''}
            </option>
          ))}
        </select>
      </div>
      {(filters.assetType !== 'all' || filters.branch !== 'all' || filters.leaseName !== '') && (
        <div className="flex items-end">
          <button
            onClick={() => onChange(DEFAULT_REPORT_FILTERS)}
            className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors"
          >
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, LayoutDashboard, Loader2 } from 'lucide-react';
import type { Lease } from '../../types/lease';
import { formatCurrency, formatDate } from '../../utils/formatting';
import {
  DEFAULT_DASHBOARD_FILTERS,
  filterDashboardRows,
  groupDashboardRows,
  sortDashboardRows,
  totalDashboardRows,
  type DashboardSortKey,
  type LeaseDashboardFilters,
  type LeaseDashboardRow,
  type LeaseDashboardTotals,
} from '../../utils/leaseDashboard';
import { downloadLeaseDashboardExcel } from '../../utils/exportLeaseDashboardExcel';
import { toUserMessage } from '../../utils/errors';
import { useSort } from '../../hooks/useSort';
import type { LeaseDashboardData } from '../../hooks/useLeaseDashboardData';
import { LoadError } from '../LoadError';

interface LeaseDashboardProps {
  data: LeaseDashboardData;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenLease: (lease: Lease) => void;
}

const COLUMNS: { key: DashboardSortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Lease name' },
  { key: 'branchName', label: 'Branch' },
  { key: 'startDate', label: 'Start date' },
  { key: 'endDate', label: 'End date' },
  { key: 'termMonths', label: 'Term (mo)', numeric: true },
  { key: 'monthsRemaining', label: 'Months left', numeric: true },
  { key: 'monthlyLease', label: 'Monthly lease', numeric: true },
  { key: 'monthlyNonlease', label: 'Monthly non-lease', numeric: true },
  { key: 'totalLease', label: 'Total lease (term)', numeric: true },
  { key: 'totalNonlease', label: 'Total non-lease (term)', numeric: true },
];

const FREQUENCY_NOTE: Record<string, string> = {
  quarterly: 'paid quarterly',
  semi_annually: 'paid semi-annually',
  annually: 'paid annually',
  weekly: 'paid weekly',
};

const selectClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
const numCell = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap';
const dash = <span className="text-slate-400">—</span>;
const defaultDir = (key: DashboardSortKey) => (key === 'name' || key === 'branchName' || key === 'startDate' || key === 'endDate' ? 'asc' : 'desc');

function TotalsRow({ label, totals, emphasis }: { label: string; totals: LeaseDashboardTotals; emphasis?: boolean }) {
  const tone = emphasis ? 'bg-slate-800 text-white font-semibold' : 'bg-slate-50 text-slate-800 font-semibold';
  return (
    <tr className={tone}>
      <td className="px-3 py-2.5 whitespace-nowrap" colSpan={6}>
        {label} <span className={emphasis ? 'text-slate-300 font-normal' : 'text-slate-500 font-normal'}>({totals.count} {totals.count === 1 ? 'lease' : 'leases'})</span>
      </td>
      <td className={numCell}>{formatCurrency(totals.monthlyLease)}</td>
      <td className={numCell}>{formatCurrency(totals.monthlyNonlease)}</td>
      <td className={numCell}>{formatCurrency(totals.totalLease)}</td>
      <td className={numCell}>{formatCurrency(totals.totalNonlease)}</td>
    </tr>
  );
}

function LeaseRow({ row, onOpen }: { row: LeaseDashboardRow; onOpen: () => void }) {
  return (
    <tr className="border-t border-slate-100 hover:bg-blue-50/40 transition-colors">
      <td className="px-3 py-2.5 min-w-[180px]">
        <button type="button" onClick={onOpen} className="text-left font-medium text-blue-700 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
          {row.name}
        </button>
        {row.expired && <span className="ml-2 align-middle text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Ended</span>}
      </td>
      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{row.branchName || dash}</td>
      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{formatDate(row.startDate)}</td>
      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{formatDate(row.endDate)}</td>
      <td className={`${numCell} text-slate-700`}>{row.termMonths}</td>
      <td className={`${numCell} text-slate-700`}>{row.monthsRemaining}</td>
      <td className={`${numCell} text-slate-900`}>
        {formatCurrency(row.monthlyLease)}
        {FREQUENCY_NOTE[row.paymentFrequency] && <div className="text-[11px] text-slate-500">{FREQUENCY_NOTE[row.paymentFrequency]}</div>}
      </td>
      <td className={`${numCell} text-slate-900`}>{row.monthlyNonlease === null ? dash : formatCurrency(row.monthlyNonlease)}</td>
      <td className={`${numCell} text-slate-900`}>{formatCurrency(row.totalLease)}</td>
      <td className={`${numCell} text-slate-900`}>{row.totalNonlease === null ? dash : formatCurrency(row.totalNonlease)}</td>
    </tr>
  );
}

export function LeaseDashboard({ data, loading, error, onRetry, onOpenLease }: LeaseDashboardProps) {
  const [filters, setFilters] = useState<LeaseDashboardFilters>(DEFAULT_DASHBOARD_FILTERS);
  const { sortKey, sortDir, handleSort } = useSort<DashboardSortKey>('name', 'asc', defaultDir);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const visible = useMemo(
    () => sortDashboardRows(filterDashboardRows(data.rows, filters), sortKey, sortDir),
    [data.rows, filters, sortKey, sortDir],
  );
  const groups = useMemo(() => groupDashboardRows(visible).filter((g) => filters.type === 'all' || g.type === filters.type), [visible, filters.type]);
  const grand = useMemo(() => totalDashboardRows(visible), [visible]);
  const hasUnbranched = data.rows.some((r) => !r.lease.branch_id);

  const setFilter = <K extends keyof LeaseDashboardFilters>(key: K, value: LeaseDashboardFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadLeaseDashboardExcel(groups, grand);
    } catch (err) {
      setExportError(toUserMessage(err, 'The Excel file could not be created. Please try again.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-labelledby="lease-dashboard-title" className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="lease-dashboard-title" className="text-lg font-semibold text-slate-900">Lease Dashboard</h2>
            <p className="text-sm text-slate-500">Lease and non-lease payments by lease type, for the selected company.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="dash-branch" className="sr-only">Filter dashboard by branch</label>
          <select id="dash-branch" className={selectClass} value={filters.branchId} onChange={(e) => setFilter('branchId', e.target.value)}>
            <option value="all">All branches</option>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            {hasUnbranched && <option value="none">No branch</option>}
          </select>
          <label htmlFor="dash-type" className="sr-only">Filter dashboard by lease type</label>
          <select id="dash-type" className={selectClass} value={filters.type} onChange={(e) => setFilter('type', e.target.value as LeaseDashboardFilters['type'])}>
            <option value="all">All types</option>
            <option value="finance">Finance</option>
            <option value="operating">Operating</option>
          </select>
          <label htmlFor="dash-status" className="sr-only">Filter dashboard by status</label>
          <select id="dash-status" className={selectClass} value={filters.status} onChange={(e) => setFilter('status', e.target.value as LeaseDashboardFilters['status'])}>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="all">All statuses</option>
          </select>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || visible.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
            Export to Excel
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="mb-3 text-sm text-red-700">{exportError}</p>}
      {error ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading lease dashboard...
        </div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
          <p className="font-medium text-slate-700">No leases match these filters</p>
          <p className="text-sm text-slate-500 mt-1">
            {data.rows.length === 0 ? 'Add a lease to see it here.' : 'Try another branch, type or status.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 border-y sm:border border-slate-200 sm:rounded-lg">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'}`}>
                      <button type="button" onClick={() => handleSort(c.key)} className={`inline-flex items-center gap-1 hover:text-slate-900 transition-colors ${active ? 'text-slate-900' : ''}`}>
                        {c.label}
                        <Icon className={`w-3.5 h-3.5 ${active ? '' : 'opacity-40'}`} aria-hidden="true" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.type} aria-label={g.label}>
                <tr className="border-t border-slate-200">
                  <th scope="rowgroup" colSpan={COLUMNS.length} className="px-3 pt-4 pb-2 text-left">
                    <span className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${g.type === 'finance' ? 'text-blue-800' : 'text-emerald-800'}`}>
                      <span className={`w-2 h-2 rounded-full ${g.type === 'finance' ? 'bg-blue-600' : 'bg-emerald-600'}`} aria-hidden="true" />
                      {g.label}
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 normal-case tracking-normal">{g.totals.count}</span>
                    </span>
                  </th>
                </tr>
                {g.rows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-3 text-slate-500">No {g.label.toLowerCase()} match these filters.</td></tr>
                ) : (
                  g.rows.map((r) => <LeaseRow key={r.id} row={r} onOpen={() => onOpenLease(r.lease)} />)
                )}
                <TotalsRow label={`${g.label} subtotal`} totals={g.totals} />
              </tbody>
            ))}
            <tfoot>
              <TotalsRow label="Grand total" totals={grand} emphasis />
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

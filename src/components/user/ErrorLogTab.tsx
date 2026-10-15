import { useState, useEffect } from 'react';
import { AlertCircle, Download, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useErrorLog, type ErrorLogRow, type ErrorLogFilters } from '../../hooks/useErrorLog';
import { exportToCsv } from '../../utils/csvExport';
import { formatDate } from '../../utils/formatting';
import { DateRangeFilter } from '../DateRangeFilter';
import { Pagination } from '../Pagination';
import { usePagination } from '../../hooks/usePagination';

interface ErrorLogTabProps {
  onError: (msg: string) => void;
}

export function ErrorLogTab({ onError }: ErrorLogTabProps) {
  const { rows, loading, error, loadErrorLogs } = useErrorLog();
  const [filters, setFilters] = useState<ErrorLogFilters>({ dateFrom: '', dateTo: '', route: '' });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { pageItems, paginationProps } = usePagination(rows, 25);

  useEffect(() => {
    if (!hasLoaded) {
      loadErrorLogs({ dateFrom: '', dateTo: '', route: '' });
      setHasLoaded(true);
    }
  }, [hasLoaded, loadErrorLogs]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  const applyFilters = () => {
    loadErrorLogs(filters);
  };

  const resetFilters = () => {
    const empty = { dateFrom: '', dateTo: '', route: '' };
    setFilters(empty);
    loadErrorLogs(empty);
  };

  const handleExport = () => {
    const headers = ['Date/Time', 'Route', 'Message', 'Stack'];
    const data = rows.map((r) => [
      formatDate(r.created_at),
      r.route ?? '',
      r.message,
      r.stack ?? '',
    ]);
    exportToCsv(`error-log-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            Error Log
          </h2>
          <p className="text-sm text-slate-500 mt-1">Review frontend errors captured across the application.</p>
        </div>
        <button
          onClick={handleExport}
          disabled={rows.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DateRangeFilter
            from={filters.dateFrom}
            to={filters.dateTo}
            onApply={(dateFrom, dateTo) => setFilters((f) => ({ ...f, dateFrom, dateTo }))}
            fromLabel="From Date"
            toLabel="To Date"
            className="md:col-span-2"
          />
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Route</label>
            <input
              type="text"
              placeholder="/leases, /billing..."
              value={filters.route}
              onChange={(e) => setFilters((f) => ({ ...f, route: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={applyFilters}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            Apply Filters
          </button>
          <button
            onClick={resetFilters}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No errors logged.</p>
        </div>
      ) : (
        <div>
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {pageItems.map((row) => (
            <ErrorRowItem
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
            />
          ))}
        </div>
        <Pagination {...paginationProps} />
        </div>
      )}
    </div>
  );
}

function ErrorRowItem({ row, expanded, onToggle }: { row: ErrorLogRow; expanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
        <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(row.created_at)}</span>
        <span className="text-xs text-slate-500 font-mono flex-shrink-0">{row.route ?? '—'}</span>
        <span className="text-sm text-slate-800 truncate flex-1">{row.message}</span>
      </button>
      {expanded && row.stack && (
        <div className="px-8 pb-4">
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 overflow-auto max-h-60 font-mono whitespace-pre-wrap">
            {row.stack}
          </pre>
        </div>
      )}
    </div>
  );
}

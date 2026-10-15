import { useState, useEffect, useCallback } from 'react';
import { Search, Download, X, FileText, ChevronRight } from 'lucide-react';
import { useAuditLog, type AuditLogRowWithLabel, type AuditLogFilters } from '../../hooks/useAuditLog';
import { AUDIT_TABLES } from '../../hooks/useAuditLog';
import { exportToCsv } from '../../utils/csvExport';
import { formatDate } from '../../utils/formatting';
import { DateRangeFilter } from '../DateRangeFilter';
import { Pagination } from '../Pagination';
import { usePagination } from '../../hooks/usePagination';

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
};

interface AuditLogTabProps {
  onError: (msg: string) => void;
}

export function AuditLogTab({ onError }: AuditLogTabProps) {
  const { rows, loading, error, users, loadAuditLogs } = useAuditLog();
  const [filters, setFilters] = useState<AuditLogFilters>({ dateFrom: '', dateTo: '', tableName: '', actorUserId: '' });
  const [selectedRow, setSelectedRow] = useState<AuditLogRowWithLabel | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { pageItems, paginationProps } = usePagination(rows, 25);

  const applyFilters = useCallback(() => {
    loadAuditLogs(filters);
  }, [filters, loadAuditLogs]);

  useEffect(() => {
    if (!hasLoaded) {
      loadAuditLogs({ dateFrom: '', dateTo: '', tableName: '', actorUserId: '' });
      setHasLoaded(true);
    }
  }, [hasLoaded, loadAuditLogs]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  const handleExport = () => {
    const headers = ['Date/Time', 'User Email', 'Table', 'Record', 'Record ID', 'Action', 'Changed Fields'];
    const userEmail = (actorId: string | null) => users.find((u) => u.user_id === actorId)?.email ?? '';
    const data = rows.map((r) => [
      formatDate(r.created_at),
      userEmail(r.actor_user_id),
      r.table_name,
      r.record_label,
      r.record_id,
      r.action,
      r.changed_fields?.join(', ') ?? '',
    ]);
    exportToCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
  };

  const resetFilters = () => {
    const empty = { dateFrom: '', dateTo: '', tableName: '', actorUserId: '' };
    setFilters(empty);
    loadAuditLogs(empty);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Audit Log
          </h2>
          <p className="text-sm text-slate-500 mt-1">Track all changes to leases, transactions, and other records.</p>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <DateRangeFilter
            from={filters.dateFrom}
            to={filters.dateTo}
            onApply={(dateFrom, dateTo) => setFilters((f) => ({ ...f, dateFrom, dateTo }))}
            fromLabel="From Date"
            toLabel="To Date"
            className="md:col-span-2"
          />
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Table</label>
            <select
              value={filters.tableName}
              onChange={(e) => setFilters((f) => ({ ...f, tableName: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All tables</option>
              {AUDIT_TABLES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">User</label>
            <select
              value={filters.actorUserId}
              onChange={(e) => setFilters((f) => ({ ...f, actorUserId: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.email || 'Unknown user'}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={applyFilters}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            <Search className="w-4 h-4" />
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
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No audit log entries found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Date/Time</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Table</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Record</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Action</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Changed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageItems.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {users.find((u) => u.user_id === row.actor_user_id)?.email ?? 'Unknown user'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">{row.table_name}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs" title={row.record_id}>{row.record_label}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${ACTION_COLORS[row.action] ?? 'bg-slate-100 text-slate-700'}`}>
                      {row.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {row.changed_fields ? row.changed_fields.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedRow(row)}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4">
            <Pagination {...paginationProps} />
          </div>
        </div>
      )}

      {selectedRow && (
        <AuditDetailsModal row={selectedRow} userEmail={users.find((u) => u.user_id === selectedRow.actor_user_id)?.email ?? ''} recordLabel={selectedRow.record_label} onClose={() => setSelectedRow(null)} />
      )}
    </div>
  );
}

function AuditDetailsModal({ row, userEmail, recordLabel, onClose }: { row: AuditLogRowWithLabel; userEmail: string; recordLabel: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">Audit Details</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <span className="text-slate-500 font-semibold">Date/Time:</span>
              <span className="text-slate-900 ml-2">{formatDate(row.created_at)}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">User:</span>
              <span className="text-slate-900 ml-2">{userEmail || 'Unknown user'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">Table:</span>
              <span className="text-slate-900 ml-2 font-mono">{row.table_name}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">Record:</span>
              <span className="text-slate-900 ml-2">{recordLabel}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">Record ID:</span>
              <span className="text-slate-900 ml-2 font-mono text-xs text-slate-400">{row.record_id}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">Action:</span>
              <span className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${ACTION_COLORS[row.action] ?? 'bg-slate-100 text-slate-700'}`}>{row.action}</span>
            </div>
            <div>
              <span className="text-slate-500 font-semibold">Changed Fields:</span>
              <span className="text-slate-900 ml-2">{row.changed_fields?.join(', ') ?? '—'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {row.old_data && (
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2">Before</h4>
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700 overflow-auto max-h-60 font-mono">
                  {JSON.stringify(row.old_data, null, 2)}
                </pre>
              </div>
            )}
            {row.new_data && (
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2">After</h4>
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700 overflow-auto max-h-60 font-mono">
                  {JSON.stringify(row.new_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

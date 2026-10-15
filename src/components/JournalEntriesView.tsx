import { useMemo, useState } from 'react';
import { Lease } from '../types/lease';
import { X, BookOpen, Download, RefreshCw } from 'lucide-react';
import { Pagination } from './Pagination';
import {
  journalEntryStatus,
  totalsByStatus,
  type JournalEntryStatus,
} from '../utils/journalEntries';
import { exportToCsv } from '../utils/csvExport';
import { useLeaseJournal } from '../hooks/useLeaseJournal';
import { LoadError } from './LoadError';

interface JournalEntriesViewProps {
  lease: Lease;
  onClose: () => void;
}

export function JournalEntriesView({ lease, onClose }: JournalEntriesViewProps) {
  const { entries, loading, error, retry, generating, postedMonths, generateEntries } = useLeaseJournal(lease);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState<'all' | JournalEntryStatus>('all');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const statusTotals = useMemo(() => totalsByStatus(entries, postedMonths), [entries, postedMonths]);
  const visibleEntries = useMemo(
    () => (statusFilter === 'all' ? entries : entries.filter((e) => journalEntryStatus(e, postedMonths) === statusFilter)),
    [entries, postedMonths, statusFilter],
  );

  const handleExportCSV = () => {
    const headers = ['Date', 'Status', 'Type', 'Account', 'Debit', 'Credit', 'Description'];
    const rows = visibleEntries.map((entry) => [
      entry.entry_date,
      journalEntryStatus(entry, postedMonths) === 'posted' ? 'Posted' : 'Projected',
      entry.entry_type,
      entry.account_name,
      entry.debit_amount,
      entry.credit_amount,
      entry.description,
    ]);
    exportToCsv(`${lease.lease_name}-journal-entries.csv`, headers, rows);
  };

  const totalDebits = visibleEntries.reduce((sum, entry) => sum + entry.debit_amount, 0);
  const totalCredits = visibleEntries.reduce((sum, entry) => sum + entry.credit_amount, 0);

  const getEntryTypeColor = (entryType: string) => {
    if (entryType === 'Lease Modification') return 'bg-amber-100 text-amber-700';
    if (entryType === 'Initial Recognition') return 'bg-teal-100 text-teal-700';
    if (entryType === 'Lease Cancellation') return 'bg-red-100 text-red-700';
    if (entryType.includes('Finance')) return 'bg-blue-100 text-blue-700';
    if (entryType.includes('Operating')) return 'bg-green-100 text-green-700';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{lease.lease_name}</h2>
              <p className="text-emerald-100 text-sm">Journal Entries</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={generateEntries}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
              <span className="text-sm font-semibold">{generating ? 'Generating...' : 'Generate / Refresh'}</span>
            </button>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-semibold">Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Filter by posting status">
            {([
              ['all', `All (${entries.length})`],
              ['posted', `Posted (${statusTotals.posted.count})`],
              ['projected', `Projected (${statusTotals.projected.count})`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setStatusFilter(value); setCurrentPage(1); }}
                aria-pressed={statusFilter === value}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${statusFilter === value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['posted', 'projected'] as const).map((s) => (
              <div key={s} className={`bg-white p-4 rounded-lg shadow-sm border-l-4 ${s === 'posted' ? 'border-l-emerald-500' : 'border-l-slate-300'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-900">{s === 'posted' ? 'Posted' : 'Projected'}</p>
                  <p className="text-xs text-slate-500">{statusTotals[s].count} entries</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Debits</p>
                    <p className="font-bold text-emerald-700">{formatCurrency(statusTotals[s].debits)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Credits</p>
                    <p className="font-bold text-blue-700">{formatCurrency(statusTotals[s].credits)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {error ? (
            <LoadError message={error} onRetry={retry} />
          ) : loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto"></div>
              <p className="text-slate-500 mt-4">Loading journal entries...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Account
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Debit
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Credit
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visibleEntries.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((entry, index) => (
                      <tr
                        key={entry.id}
                        className={
                          entry.entry_type === 'Lease Modification'
                            ? 'bg-amber-50 border-l-4 border-l-amber-400'
                            : entry.entry_type === 'Initial Recognition'
                            ? 'bg-teal-50 border-l-4 border-l-teal-400'
                            : entry.entry_type === 'Lease Cancellation'
                            ? 'bg-red-50 border-l-4 border-l-red-400'
                            : index % 2 === 0
                            ? 'bg-white'
                            : 'bg-slate-50'
                        }
                      >
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {formatDate(entry.entry_date)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {journalEntryStatus(entry, postedMonths) === 'posted' ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Posted</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Projected</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${getEntryTypeColor(entry.entry_type)}`}>
                            {entry.entry_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 font-semibold">
                          {entry.account_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-emerald-600 text-right font-medium">
                          {entry.debit_amount > 0 ? formatCurrency(entry.debit_amount) : ''}
                        </td>
                        <td className="px-4 py-3 text-sm text-blue-600 text-right font-medium">
                          {entry.credit_amount > 0 ? formatCurrency(entry.credit_amount) : ''}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{entry.description}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-bold">
                      <td colSpan={4} className="px-4 py-3 text-right">
                        {statusFilter === 'all' ? 'TOTALS:' : `${statusFilter === 'posted' ? 'POSTED' : 'PROJECTED'} TOTALS:`}
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totalDebits)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totalCredits)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(visibleEntries.length / pageSize)}
                totalItems={visibleEntries.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

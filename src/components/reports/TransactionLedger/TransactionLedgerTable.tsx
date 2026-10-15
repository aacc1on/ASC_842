import { Pagination } from '../../Pagination';
import { parseLocalDate } from '../../../utils/formatting';
import { type DetailedLedgerEntry } from '../../../utils/reports/ledger';
import { Receipt, Download } from 'lucide-react';

import { buildLedgerCsv } from '../../../utils/reports/ledger';
import { formatCurrency, formatDate } from '../shared/formatters';

export function TransactionLedgerTable({
  detailedLedger,
  periodStart,
  periodEnd,
  ledgerPage,
  ledgerPageSize,
  setLedgerPage,
  setLedgerPageSize,
}: {
  detailedLedger: DetailedLedgerEntry[];
  periodStart: string;
  periodEnd: string;
  ledgerPage: number;
  ledgerPageSize: number;
  setLedgerPage: (page: number) => void;
  setLedgerPageSize: (size: number) => void;
}) {
  const downloadLedgerCSV = () => {
    const blob = new Blob([buildLedgerCsv(detailedLedger)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transaction-ledger-${periodStart}-to-${periodEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2 rounded-lg">
            <Receipt className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Transaction Ledger</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatDate(parseLocalDate(periodStart))} — {formatDate(parseLocalDate(periodEnd))}
            </p>
          </div>
        </div>
        {detailedLedger.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-2xl font-bold text-slate-900">{detailedLedger.length}</span>
              <p className="text-xs text-slate-500">journal entries</p>
            </div>
            <button
              onClick={downloadLedgerCSV}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </button>
          </div>
        )}
      </div>

      {detailedLedger.length > 0 ? (
        <>
          <div className="grid grid-cols-5 gap-px bg-slate-100 border-b border-slate-200">
            {[
              { label: 'Total Amount', value: detailedLedger.reduce((s, e) => s + e.amount, 0), color: 'text-slate-900' },
              { label: 'Initial Recognition', value: detailedLedger.filter(e => e.entryType === 'Initial Recognition').reduce((s, e) => s + e.amount, 0), color: 'text-blue-700' },
              { label: 'Modifications', value: detailedLedger.filter(e => e.entryType === 'Modification' || e.entryType === 'Remeasurement').reduce((s, e) => s + e.amount, 0), color: 'text-orange-600' },
              { label: 'Cancellations', value: detailedLedger.filter(e => e.entryType === 'Lease Cancellation').reduce((s, e) => s + e.amount, 0), color: 'text-red-600' },
              { label: 'Terminations', value: detailedLedger.filter(e => e.entryType === 'Termination' || e.entryType === 'Derecognition').reduce((s, e) => s + e.amount, 0), color: 'text-rose-600' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-5 py-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">{stat.label}</p>
                <p className={`text-lg font-bold mt-1 ${stat.color}`}>{formatCurrency(stat.value)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide whitespace-nowrap">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Entry Type</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Description</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Account Debited</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Account Credited</th>
                  <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detailedLedger.slice((ledgerPage - 1) * ledgerPageSize, ledgerPage * ledgerPageSize).map((entry, index) => {
                  const entryColors: Record<string, string> = {
                    'Initial Recognition': 'bg-blue-50 text-blue-700 border border-blue-200',
                    'Prepayment': 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
                    'Modification': 'bg-orange-50 text-orange-700 border border-orange-200',
                    'Remeasurement': 'bg-amber-50 text-amber-700 border border-amber-200',
                    'Termination': 'bg-red-50 text-red-700 border border-red-200',
                    'Interest Accrual': 'bg-sky-50 text-sky-700 border border-sky-200',
                    'Lease Payment': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                    'Depreciation': 'bg-slate-100 text-slate-700 border border-slate-200',
                    'Operating Lease Expense': 'bg-teal-50 text-teal-700 border border-teal-200',
                  };
                  const colorClass = entryColors[entry.entryType] || 'bg-slate-50 text-slate-700 border border-slate-200';
                  const dateObj = new Date(entry.date + 'T00:00:00');
                  return (
                    <tr key={(ledgerPage - 1) * ledgerPageSize + index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-slate-700 whitespace-nowrap font-medium">
                        {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
                          {entry.entryType}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700 max-w-xs">
                        <span className="line-clamp-2">{entry.description}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-semibold text-green-700">{entry.accountDebited}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-semibold text-red-600">{entry.accountCredited}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrency(entry.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-300">
                  <td colSpan={5} className="px-5 py-3 text-sm font-bold text-slate-900">
                    Total ({detailedLedger.length} entries)
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                    {formatCurrency(detailedLedger.reduce((s, e) => s + e.amount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="px-6">
            <Pagination
              currentPage={ledgerPage}
              totalPages={Math.ceil(detailedLedger.length / ledgerPageSize)}
              totalItems={detailedLedger.length}
              pageSize={ledgerPageSize}
              onPageChange={setLedgerPage}
              onPageSizeChange={setLedgerPageSize}
              pageSizeOptions={[25, 50, 100, 250]}
            />
          </div>

          <div className="px-6 py-4 bg-blue-50 border-t border-blue-100">
            <h4 className="text-xs font-bold text-blue-900 uppercase mb-2">Accounting Legend</h4>
            <div className="flex flex-wrap gap-6 text-xs text-blue-800">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-green-700">Debit:</span>
                <span>Increase in assets or expenses</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-red-600">Credit:</span>
                <span>Increase in liabilities or equity</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">Note:</span>
                <span>Shows all stored transactions within the selected period</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <Receipt className="w-14 h-14 mx-auto mb-4 text-slate-200" />
          <p className="font-semibold text-slate-600">No transactions found for this period</p>
          <p className="text-sm mt-1">Adjust the period start and end dates to see entries</p>
        </div>
      )}
    </div>
  );
}

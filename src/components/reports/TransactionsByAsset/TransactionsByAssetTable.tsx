import { Building2, Maximize2, Minimize2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

import { type AssetSortKey, type AssetTransactionRow } from '../../../utils/reports/transactionsByAsset';
import { formatCurrency } from '../shared/formatters';
import { LoadError } from '../../LoadError';

export function TransactionsByAssetTable({
  assetTransactions,
  sortedAssetTransactions,
  assetTxnLoading,
  assetTxnError,
  retryAssetTransactions,
  breakdownError,
  assetTxnFullscreen,
  setAssetTxnFullscreen,
  assetSortKey,
  assetSortDir,
  handleAssetSort,
  loadAssetBreakdown,
}: {
  assetTransactions: AssetTransactionRow[];
  sortedAssetTransactions: AssetTransactionRow[];
  assetTxnLoading: boolean;
  assetTxnError: string | null;
  retryAssetTransactions: () => void;
  breakdownError: { message: string; retry: () => void } | null;
  assetTxnFullscreen: boolean;
  setAssetTxnFullscreen: (v: boolean) => void;
  assetSortKey: AssetSortKey;
  assetSortDir: 'asc' | 'desc';
  handleAssetSort: (key: AssetSortKey) => void;
  loadAssetBreakdown: (leaseId: string, leaseName: string, column: string) => void;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${assetTxnFullscreen ? 'fixed inset-0 z-50 rounded-none border-0 flex flex-col' : ''}`}>
      <div className="px-6 py-5 border-b border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-teal-100 p-2 rounded-lg">
            <Building2 className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Transaction by Assets</h3>
            <p className="text-xs text-slate-500 mt-0.5">Summary per lease for selected period</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setAssetTxnFullscreen(!assetTxnFullscreen)}
            className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
            title={assetTxnFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {assetTxnFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {breakdownError && <LoadError message={breakdownError.message} onRetry={breakdownError.retry} className="mx-6 mt-4" />}

      {assetTxnError ? (
        <LoadError message={assetTxnError} onRetry={retryAssetTransactions} className="m-6" />
      ) : assetTxnLoading ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-sm text-slate-500">Loading asset transactions...</p>
        </div>
      ) : sortedAssetTransactions.length > 0 ? (
        <div className={`overflow-x-auto ${assetTxnFullscreen ? 'flex-1' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {([
                  { key: 'leaseName' as AssetSortKey, label: 'Lease', align: 'left', color: 'text-slate-600' },
                  { key: 'classification' as AssetSortKey, label: 'Type', align: 'left', color: 'text-slate-600' },
                  { key: 'initialRecognition' as AssetSortKey, label: 'Initial Recognition', align: 'right', color: 'text-blue-700' },
                  { key: 'accumulatedDepreciation' as AssetSortKey, label: 'Accum. Depreciation', align: 'right', color: 'text-red-700' },
                  { key: 'endingRou' as AssetSortKey, label: 'Ending ROU', align: 'right', color: 'text-teal-700' },
                  { key: 'liability' as AssetSortKey, label: 'Beg. Liability', align: 'right', color: 'text-orange-700' },
                  { key: 'interestRecognized' as AssetSortKey, label: 'Interest Recognized', align: 'right', color: 'text-sky-700' },
                  { key: 'leasePayment' as AssetSortKey, label: 'Lease Payment', align: 'right', color: 'text-emerald-700' },
                  { key: 'endingLeaseLiability' as AssetSortKey, label: 'Ending Liability', align: 'right', color: 'text-slate-700' },
                ]).map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleAssetSort(col.key)}
                    className={`px-4 py-3 text-xs font-bold ${col.color} uppercase whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors select-none ${col.align === 'left' ? 'text-left' : 'text-right'} ${col.key === 'leaseName' ? 'sticky left-0 bg-slate-50 z-10 min-w-[180px]' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {assetSortKey === col.key ? (
                        assetSortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedAssetTransactions.map((row) => (
                <tr key={row.leaseId} className="hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 bg-inherit px-5 py-3 font-semibold text-slate-800 z-10 whitespace-nowrap">{row.leaseName}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${row.classification === 'finance' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                      {row.classification}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right font-medium text-blue-700 tabular-nums cursor-pointer hover:bg-blue-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Initial Recognition')}
                  >
                    {formatCurrency(row.initialRecognition)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-medium text-red-700 tabular-nums cursor-pointer hover:bg-red-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Accum. Depreciation')}
                  >
                    ({formatCurrency(row.accumulatedDepreciation)})
                  </td>
                  <td
                    className="px-4 py-3 text-right font-bold text-teal-700 tabular-nums cursor-pointer hover:bg-teal-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Ending ROU')}
                  >
                    {formatCurrency(row.endingRou)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-medium text-orange-700 tabular-nums cursor-pointer hover:bg-orange-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Beg. Liability')}
                  >
                    {formatCurrency(row.liability)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-medium text-sky-700 tabular-nums cursor-pointer hover:bg-sky-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Interest Recognized')}
                  >
                    {formatCurrency(row.interestRecognized)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-medium text-emerald-700 tabular-nums cursor-pointer hover:bg-emerald-50 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Lease Payment')}
                  >
                    {formatCurrency(row.leasePayment)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums cursor-pointer hover:bg-slate-100 rounded transition-colors"
                    onClick={() => loadAssetBreakdown(row.leaseId, row.leaseName, 'Ending Liability')}
                  >
                    {formatCurrency(row.endingLeaseLiability)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-300">
                <td className="sticky left-0 bg-slate-50 px-5 py-3 font-bold text-slate-900 z-10">
                  Total ({assetTransactions.length} {assetTransactions.length === 1 ? 'lease' : 'leases'})
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-bold text-blue-700 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.initialRecognition, 0))}</td>
                <td className="px-4 py-3 text-right font-bold text-red-700 tabular-nums">({formatCurrency(assetTransactions.reduce((s, r) => s + r.accumulatedDepreciation, 0))})</td>
                <td className="px-4 py-3 text-right font-bold text-teal-700 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.endingRou, 0))}</td>
                <td className="px-4 py-3 text-right font-bold text-orange-700 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.liability, 0))}</td>
                <td className="px-4 py-3 text-right font-bold text-sky-700 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.interestRecognized, 0))}</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.leasePayment, 0))}</td>
                <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">{formatCurrency(assetTransactions.reduce((s, r) => s + r.endingLeaseLiability, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <Building2 className="w-14 h-14 mx-auto mb-4 text-slate-200" />
          <p className="font-semibold text-slate-600">No asset transactions found for this period</p>
          <p className="text-sm mt-1">Adjust the custom period or check that leases have amortization schedules</p>
        </div>
      )}
    </div>
  );
}

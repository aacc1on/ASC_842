import { X } from 'lucide-react';

import { type AssetBreakdownDetail } from '../../../utils/reports/transactionsByAsset';
import { formatCurrency } from '../shared/formatters';

export function AssetBreakdownModal({
  assetBreakdown,
  setAssetBreakdown,
  periodStart,
  periodEnd,
}: {
  assetBreakdown: AssetBreakdownDetail;
  setAssetBreakdown: (v: AssetBreakdownDetail | null) => void;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setAssetBreakdown(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{assetBreakdown.column}</h3>
            <p className="text-sm text-slate-500">{assetBreakdown.leaseName} — {periodStart} to {periodEnd}</p>
          </div>
          <button onClick={() => setAssetBreakdown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {assetBreakdown.transactions.length > 0 ? (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="pb-2 text-left text-xs font-bold text-slate-600 uppercase">Date</th>
                  <th className="pb-2 text-left text-xs font-bold text-slate-600 uppercase">Type</th>
                  <th className="pb-2 text-left text-xs font-bold text-slate-600 uppercase">Description</th>
                  <th className="pb-2 text-right text-xs font-bold text-slate-600 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assetBreakdown.transactions.map((txn, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="py-2.5 text-slate-700 whitespace-nowrap">
                      {new Date(txn.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-2.5 text-slate-600 capitalize">{txn.type.replace(/_/g, ' ')}</td>
                    <td className="py-2.5 text-slate-600 max-w-[200px] truncate">{txn.description || '—'}</td>
                    <td className="py-2.5 text-right font-medium text-slate-900 tabular-nums">{formatCurrency(txn.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300">
                  <td colSpan={3} className="pt-3 font-bold text-slate-900">Total ({assetBreakdown.transactions.length} entries)</td>
                  <td className="pt-3 text-right font-bold text-slate-900 tabular-nums">{formatCurrency(assetBreakdown.transactions.reduce((s, t) => s + t.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-500">
              <p className="font-medium">No individual transactions found</p>
              <p className="text-sm mt-1">This value may be derived from the amortization schedule rather than stored transactions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

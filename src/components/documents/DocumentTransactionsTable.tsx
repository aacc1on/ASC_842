import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { getTypeColor, type DocumentTransaction } from './monthEndDocHelpers';

export function DocumentTransactionsTable({ periodLabel, txns }: { periodLabel: string; txns: DocumentTransaction[] }) {
  return (
    <>
      <div className="px-5 py-3 bg-slate-50 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-700">
          Journal Entries — {periodLabel}
        </span>
        <span className="text-xs text-slate-500">{txns.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Date</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Lease</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Type</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Description</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">
                <span className="flex items-center gap-1">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-green-600" />
                  Account Dr
                </span>
              </th>
              <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Debit</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">
                <span className="flex items-center gap-1">
                  <ArrowDownCircle className="w-3.5 h-3.5 text-orange-600" />
                  Account Cr
                </span>
              </th>
              <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {txns.map((txn) => (
              <tr key={txn.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                  {formatDate(txn.transaction_date)}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-900 max-w-[140px] truncate">
                  {txn.lease_name}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getTypeColor(txn.transaction_type)}`}>
                    {txn.transaction_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-[200px] truncate" title={txn.description}>
                  {txn.description}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{txn.account_debited}</td>
                <td className="px-4 py-3 text-sm text-right font-semibold text-slate-900">
                  {formatCurrency(txn.debit_amount)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{txn.account_credited}</td>
                <td className="px-5 py-3 text-sm text-right font-semibold text-slate-900">
                  {formatCurrency(txn.credit_amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-100 border-t-2 border-slate-300">
            <tr>
              <td colSpan={5} className="px-5 py-3 text-sm font-bold text-slate-700 text-right">
                Totals:
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">
                {formatCurrency(txns.reduce((s, t) => s + Number(t.debit_amount), 0))}
              </td>
              <td></td>
              <td className="px-5 py-3 text-sm font-bold text-slate-900 text-right">
                {formatCurrency(txns.reduce((s, t) => s + Number(t.credit_amount), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

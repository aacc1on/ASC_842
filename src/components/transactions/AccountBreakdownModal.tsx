import { X } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import type { Transaction } from './types';

interface AccountBreakdownModalProps {
  side: 'debit' | 'credit';
  account: string;
  filteredTransactions: Transaction[];
  onClose: () => void;
}

export function AccountBreakdownModal({
  side,
  account,
  filteredTransactions,
  onClose,
}: AccountBreakdownModalProps) {
  const isDebit = side === 'debit';
  const rows = filteredTransactions.filter((t) =>
    isDebit ? t.account_debited === account && Number(t.debit_amount) > 0 : t.account_credited === account && Number(t.credit_amount) > 0,
  );
  const total = rows.reduce(
    (s, t) => s + (isDebit ? Number(t.debit_amount) : Number(t.credit_amount)),
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{account}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isDebit ? 'Debit' : 'Credit'} breakdown · {rows.length} entries · {formatCurrency(total)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No entries for this account.</p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Lease</th>
                    <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Description</th>
                    <th className="text-left px-3 py-2 font-semibold">Branch</th>
                    <th className="text-right px-3 py-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((t) => (
                    <tr key={`${t.id}-${t.created_at}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(t.transaction_date)}</td>
                      <td className="px-3 py-2 text-slate-800">{t.lease_name ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 hidden md:table-cell truncate max-w-[16rem]">
                        {t.description || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{t.branch_name ?? '—'}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${isDebit ? 'text-emerald-700' : 'text-orange-700'}`}>
                        {formatCurrency(isDebit ? t.debit_amount : t.credit_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-right text-slate-700">
                      Total
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${isDebit ? 'text-emerald-700' : 'text-orange-700'}`}>
                      {formatCurrency(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

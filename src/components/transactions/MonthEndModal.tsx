import { X, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../utils/formatting';
import { CatchUpCorrections } from '../documents/CatchUpCorrections';

interface MonthEndPreviewRow {
  lease_id: string;
  lease_name: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  reference_number: string;
  period: string;
}

interface MonthEndModalProps {
  monthEndPeriod: string;
  setMonthEndPeriod: (v: string) => void;
  monthEndPreview: MonthEndPreviewRow[];
  submitting: boolean;
  errorMessage: string;
  successMessage: string;
  onClose: () => void;
  onGeneratePreview: () => void;
  onProcess: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  payment: 'Payment',
  interest: 'Interest',
  amortization: 'Depreciation',
  operating_lease_expense: 'Operating Lease Expense',
  month_end_catch_up: 'Catch-up',
};

export function MonthEndModal({
  monthEndPeriod,
  setMonthEndPeriod,
  monthEndPreview,
  submitting,
  errorMessage,
  successMessage,
  onClose,
  onGeneratePreview,
  onProcess,
}: MonthEndModalProps) {
  const totalDebits = monthEndPreview.reduce((s, t) => s + Number(t.debit_amount ?? 0), 0);
  const totalCredits = monthEndPreview.reduce((s, t) => s + Number(t.credit_amount ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Month-End Processing</h2>
          <button onClick={onClose} aria-label="Close month-end processing dialog" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Period (YYYY-MM)</label>
              <input
                type="month"
                value={monthEndPeriod}
                onChange={(e) => setMonthEndPeriod(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <button
              onClick={onGeneratePreview}
              disabled={submitting || !monthEndPeriod}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Preview
            </button>
          </div>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {successMessage}
            </div>
          )}

          {monthEndPreview.length > 0 && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-700">
                  {monthEndPreview.length} entries to post
                </span>
                <span className="text-slate-500">
                  Debits {formatCurrency(totalDebits)} · Credits {formatCurrency(totalCredits)}
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Lease</th>
                      <th className="text-left px-3 py-2 font-semibold">Type</th>
                      <th className="text-left px-3 py-2 font-semibold">Account</th>
                      <th className="text-right px-3 py-2 font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthEndPreview.map((t, i) => (
                      <tr key={`${t.lease_id}-${t.transaction_type}-${i}`}>
                        <td className="px-3 py-2 text-slate-700 truncate max-w-[12rem]">{t.lease_name}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {TYPE_LABEL[t.transaction_type] ?? t.transaction_type}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <div>{t.account_debited}</div>
                          <div className="text-slate-500">{t.account_credited}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">
                          {formatCurrency(t.debit_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <CatchUpCorrections period={monthEndPeriod} compact />
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Close
          </button>
          <button
            onClick={onProcess}
            disabled={submitting || monthEndPreview.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader className="w-4 h-4 animate-spin" />}
            Process Month-End
          </button>
        </div>
      </div>
    </div>
  );
}

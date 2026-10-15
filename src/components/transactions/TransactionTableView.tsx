import { Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { Pagination } from '../Pagination';
import { TYPE_BADGE } from './typeBadges';
import type { Lease } from '../../types/lease';
import type { UserPermissions } from '../../App';
import type { Transaction } from './types';

interface TransactionTableViewProps {
  transactions: Transaction[];
  leases: Lease[];
  permissions: UserPermissions;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  pageSizeOptions?: number[];
  totalCount: number;
  onSelectTransaction: (t: Transaction) => void;
  onDeleteTransaction: (t: Transaction) => void;
}

export function TransactionTableView({
  transactions,
  leases,
  permissions,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  pageSizeOptions,
  totalCount,
  onSelectTransaction,
  onDeleteTransaction,
}: TransactionTableViewProps) {
  const leaseName = (t: Transaction) =>
    t.lease_name ?? leases.find((l) => l.id === t.lease_id)?.lease_name ?? 'Unknown Lease';
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageDebit = transactions.reduce((s, t) => s + (Number(t.debit_amount) || 0), 0);
  const pageCredit = transactions.reduce((s, t) => s + (Number(t.credit_amount) || 0), 0);

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3 whitespace-nowrap">Date</th>
                <th className="px-4 py-3">Lease</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Debit account</th>
                <th className="px-4 py-3">Credit account</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3">Period</th>
                {permissions.delete_leases && <th className="px-4 py-3 w-10" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={permissions.delete_leases ? 9 : 8} className="px-4 py-10 text-center text-slate-500">
                    No transactions match the current filters.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr
                    key={`${t.id}-${t.created_at}`}
                    onClick={() => onSelectTransaction(t)}
                    className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${t.is_reversed ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatDate(t.transaction_date)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900 max-w-[200px] truncate">{leaseName(t)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full whitespace-nowrap ${TYPE_BADGE[t.transaction_type] ?? 'bg-slate-100 text-slate-700'}`}>
                        {t.transaction_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{t.account_debited}</td>
                    <td className="px-4 py-3 text-slate-700">{t.account_credited}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(t.debit_amount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-orange-700 whitespace-nowrap">{formatCurrency(t.credit_amount)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {t.period}
                      {t.is_reversed && <span className="ml-2 text-xs font-semibold text-red-600">Reversed</span>}
                    </td>
                    {permissions.delete_leases && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTransaction(t);
                          }}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete transaction"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {transactions.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr className="font-semibold text-slate-800">
                  <td className="px-4 py-3" colSpan={5}>Total on this page ({transactions.length})</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(pageDebit)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(pageCredit)}</td>
                  <td colSpan={permissions.delete_leases ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalCount}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={pageSizeOptions}
      />
    </div>
  );
}

import { ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../utils/formatting';
import { Pagination } from '../Pagination';
import type { AccountSummaryItem } from './types';
import type { BranchColumn } from '../../hooks/useTransactionSummary';

interface DebitsByAccountTableProps {
  debitAccountSummary: AccountSummaryItem[];
  activeBranches: BranchColumn[];
  debitByAccountAndBranch: Record<string, Record<string, number>>;
  totalDebits: number;
  debitAcctPage: number;
  setDebitAcctPage: (p: number) => void;
  acctPageSize: number;
  onOpenBreakdown: (account: string) => void;
}

export function DebitsByAccountTable({
  debitAccountSummary,
  activeBranches,
  debitByAccountAndBranch,
  totalDebits,
  debitAcctPage,
  setDebitAcctPage,
  acctPageSize,
  onOpenBreakdown,
}: DebitsByAccountTableProps) {
  const totalPages = Math.max(1, Math.ceil(debitAccountSummary.length / acctPageSize));
  const page = Math.min(debitAcctPage, totalPages);
  const start = (page - 1) * acctPageSize;
  const pageItems = debitAccountSummary.slice(start, start + acctPageSize);
  const colCount = activeBranches.length + 3;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-emerald-50">
        <h3 className="font-bold text-emerald-900">Debits by Account</h3>
        <p className="text-xs text-emerald-700 mt-0.5">{formatCurrency(totalDebits)} total</p>
      </div>

      <div className="overflow-x-auto max-h-[28rem]">
        <table className="text-sm border-collapse">
          <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-2 font-semibold sticky left-0 bg-slate-50 z-20 whitespace-nowrap">
                Account
              </th>
              {activeBranches.map((b) => (
                <th key={b.id} className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                  {b.label}
                </th>
              ))}
              <th className="text-right px-4 py-2 font-semibold whitespace-nowrap">Total</th>
              <th className="px-2 py-2 sticky right-0 bg-slate-50 z-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="text-center text-slate-500 py-8">
                  No debit entries
                </td>
              </tr>
            ) : (
              pageItems.map((row) => (
                <tr key={row.account} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800 sticky left-0 bg-white z-10 whitespace-nowrap">
                    {row.account}
                  </td>
                  {activeBranches.map((b) => {
                    const val = debitByAccountAndBranch[row.account]?.[b.id];
                    return (
                      <td key={b.id} className="text-right px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                        {val ? formatCurrency(val) : '—'}
                      </td>
                    );
                  })}
                  <td className="text-right px-4 py-2.5 font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                    {formatCurrency(row.total)}
                  </td>
                  <td className="px-2 py-2.5 text-right sticky right-0 bg-white z-10">
                    <button
                      onClick={() => onOpenBreakdown(row.account)}
                      className="text-slate-500 hover:text-blue-600 transition"
                      title="View breakdown"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {debitAccountSummary.length > acctPageSize && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={debitAccountSummary.length}
          pageSize={acctPageSize}
          onPageChange={setDebitAcctPage}
        />
      )}
    </div>
  );
}

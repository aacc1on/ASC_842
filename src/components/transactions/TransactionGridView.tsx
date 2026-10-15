import { Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { Pagination } from '../Pagination';
import type { Lease } from '../../types/lease';
import type { UserPermissions } from '../../App';
import type { Transaction } from './types';
import { TYPE_BADGE } from './typeBadges';

interface TransactionGridViewProps {
  transactions: Transaction[];
  leases: Lease[];
  permissions: UserPermissions;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  pageSizeOptions?: number[];
  isServerMode: boolean;
  serverTotalCount: number;
  onSelectTransaction: (t: Transaction) => void;
  onDeleteTransaction: (t: Transaction) => void;
}

export function TransactionGridView({
  transactions,
  leases,
  permissions,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  pageSizeOptions,
  isServerMode,
  serverTotalCount,
  onSelectTransaction,
  onDeleteTransaction,
}: TransactionGridViewProps) {
  const leaseName = (t: Transaction) =>
    t.lease_name ?? leases.find((l) => l.id === t.lease_id)?.lease_name ?? 'Unknown Lease';

  const totalItems = isServerMode ? serverTotalCount : transactions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {transactions.map((t) => (
          <button
            key={`${t.id}-${t.created_at}`}
            onClick={() => onSelectTransaction(t)}
            className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-blue-300 transition flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 truncate">{leaseName(t)}</p>
                <p className="text-xs text-slate-500">{formatDate(t.transaction_date)}</p>
              </div>
              <span
                className={`px-2 py-0.5 text-xs font-bold rounded-full whitespace-nowrap ${
                  TYPE_BADGE[t.transaction_type] ?? 'bg-slate-100 text-slate-700'
                }`}
              >
                {t.transaction_type.replace(/_/g, ' ')}
              </span>
            </div>

            <p className="text-sm text-slate-600 line-clamp-2 min-h-[2.5rem]">
              {t.description || 'No description'}
            </p>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                  <ArrowDownCircle className="w-4 h-4" />
                  {formatCurrency(t.debit_amount)}
                </span>
                <span className="flex items-center gap-1 text-orange-700 font-semibold">
                  <ArrowUpCircle className="w-4 h-4" />
                  {formatCurrency(t.credit_amount)}
                </span>
              </div>
              {t.is_reversed && (
                <span className="text-xs font-semibold text-red-600">Reversed</span>
              )}
            </div>

            {permissions.delete_leases && (
              <div className="flex justify-end">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTransaction(t);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onDeleteTransaction(t);
                    }
                  }}
                  className="text-slate-500 hover:text-red-600 transition cursor-pointer"
                  title="Delete transaction"
                >
                  <Trash2 className="w-4 h-4" />
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={pageSizeOptions}
      />
    </div>
  );
}

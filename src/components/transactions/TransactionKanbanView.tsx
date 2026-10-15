import { Trash2 } from 'lucide-react';
import { Pagination } from '../Pagination';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency, formatDate } from '../../utils/formatting';
import type { Lease } from '../../types/lease';
import type { UserPermissions } from '../../App';
import type { Transaction } from './types';

interface TransactionKanbanViewProps {
  filteredTransactions: Transaction[];
  leases: Lease[];
  permissions: UserPermissions;
  onSelectTransaction: (t: Transaction) => void;
  onDeleteTransaction: (t: Transaction) => void;
}

interface KanbanColumn {
  key: string;
  label: string;
  accent: string;
  badge: string;
}

const COLUMNS: KanbanColumn[] = [
  { key: 'payment', label: 'Payments', accent: 'border-blue-300', badge: 'bg-blue-100 text-blue-700' },
  { key: 'interest', label: 'Interest', accent: 'border-orange-300', badge: 'bg-orange-100 text-orange-700' },
  { key: 'amortization', label: 'Depreciation', accent: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'initial_recognition', label: 'Initial Recognition', accent: 'border-purple-300', badge: 'bg-purple-100 text-purple-700' },
  { key: 'other', label: 'Other', accent: 'border-slate-300', badge: 'bg-slate-100 text-slate-700' },
];

export function TransactionKanbanView({
  filteredTransactions,
  leases,
  permissions,
  onSelectTransaction,
  onDeleteTransaction,
}: TransactionKanbanViewProps) {
  const leaseName = (t: Transaction) =>
    t.lease_name ?? leases.find((l) => l.id === t.lease_id)?.lease_name ?? 'Unknown Lease';

  const { pageItems, paginationProps } = usePagination(filteredTransactions, 25);
  const { currentPage, totalPages } = paginationProps;

  const columnKey = (t: Transaction) =>
    COLUMNS.some((c) => c.key === t.transaction_type) ? t.transaction_type : 'other';
  const allByColumn: Record<string, Transaction[]> = {};
  for (const t of filteredTransactions) (allByColumn[columnKey(t)] ??= []).push(t);
  const pageByColumn: Record<string, Transaction[]> = {};
  for (const t of pageItems) (pageByColumn[columnKey(t)] ??= []).push(t);

  return (
    <div>
    {totalPages > 1 && (
      <p className="text-xs text-slate-500 mb-3">
        Column counts and totals cover all {filteredTransactions.length} matching entries; cards below show page {currentPage} of {totalPages}.
      </p>
    )}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {COLUMNS.map((col) => {
        const all = allByColumn[col.key] ?? [];
        const items = pageByColumn[col.key] ?? [];
        const subtotal = all.reduce((s, t) => s + Number(t.debit_amount ?? 0), 0);
        return (
          <div key={col.key} className={`bg-slate-50 rounded-xl border-t-4 ${col.accent} p-3 flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">{col.label}</h3>
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${col.badge}`}>{all.length}</span>
            </div>
            <p className="text-xs text-slate-500 -mt-2">{formatCurrency(subtotal)}</p>

            <div className="flex flex-col gap-2 min-h-[4rem]">
              {items.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  {all.length > 0 ? 'None on this page' : 'No entries'}
                </p>
              ) : (
                items.map((t) => (
                  <div
                    key={`${t.id}-${t.created_at}`}
                    className="bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition"
                    onClick={() => onSelectTransaction(t)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{leaseName(t)}</p>
                      {permissions.delete_leases && (
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
                          className="text-slate-500 hover:text-red-600 transition"
                          title="Delete transaction"
                        >
                          <Trash2 className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(t.transaction_date)}</p>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{t.description}</p>
                    <p className="text-sm font-semibold text-slate-800 mt-2">
                      {formatCurrency(t.debit_amount || t.credit_amount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    {filteredTransactions.length > 0 && (
      <Pagination {...paginationProps} pageSizeOptions={[25, 50, 100]} />
    )}
    </div>
  );
}

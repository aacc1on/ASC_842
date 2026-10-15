import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Pagination } from '../Pagination';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency, formatDate } from '../../utils/formatting';
import type { Lease } from '../../types/lease';
import type { UserPermissions } from '../../App';
import type { Transaction, TransactionSection, WeeklyGroup } from './types';

interface WeeklyTransactionsViewProps {
  weeklyGroups: WeeklyGroup[];
  expandedWeeks: Record<string, boolean>;
  expandedSections: Record<string, boolean>;
  toggleWeek: (key: string) => void;
  toggleSection: (key: string) => void;
  leases: Lease[];
  permissions: UserPermissions;
  onSelectTransaction: (t: Transaction) => void;
  onDeleteTransaction: (t: Transaction) => void;
}

function sectionKey(weekKey: string, side: TransactionSection): string {
  return `${weekKey}:${side}`;
}

export function WeeklyTransactionsView({
  weeklyGroups,
  expandedWeeks,
  expandedSections,
  toggleWeek,
  toggleSection,
  leases,
  permissions,
  onSelectTransaction,
  onDeleteTransaction,
}: WeeklyTransactionsViewProps) {
  const leaseName = (t: Transaction) =>
    t.lease_name ?? leases.find((l) => l.id === t.lease_id)?.lease_name ?? 'Unknown Lease';

  const { pageItems: pageWeeks, paginationProps } = usePagination(weeklyGroups, 10);

  return (
    <div>
    <div className="space-y-3">
      {pageWeeks.map((week) => {
        const weekOpen = expandedWeeks[week.weekKey];
        return (
          <div key={week.weekKey} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleWeek(week.weekKey)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition"
            >
              <div className="flex items-center gap-3">
                {weekOpen ? (
                  <ChevronDown className="w-5 h-5 text-slate-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-500" />
                )}
                <div className="text-left">
                  <p className="font-bold text-slate-900">{week.weekLabel}</p>
                  <p className="text-xs text-slate-500">{week.transactions.length} transactions</p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-emerald-700 font-semibold">{formatCurrency(week.totalDebits)} Dr</span>
                <span className="text-orange-700 font-semibold">{formatCurrency(week.totalCredits)} Cr</span>
              </div>
            </button>

            {weekOpen && (
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                <WeekSection
                  week={week}
                  side="debits"
                  open={expandedSections[sectionKey(week.weekKey, 'debits')]}
                  onToggle={() => toggleSection(sectionKey(week.weekKey, 'debits'))}
                  leaseName={leaseName}
                  permissions={permissions}
                  onSelectTransaction={onSelectTransaction}
                  onDeleteTransaction={onDeleteTransaction}
                />
                <WeekSection
                  week={week}
                  side="credits"
                  open={expandedSections[sectionKey(week.weekKey, 'credits')]}
                  onToggle={() => toggleSection(sectionKey(week.weekKey, 'credits'))}
                  leaseName={leaseName}
                  permissions={permissions}
                  onSelectTransaction={onSelectTransaction}
                  onDeleteTransaction={onDeleteTransaction}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
    {weeklyGroups.length > 0 && (
      <Pagination {...paginationProps} pageSizeOptions={[5, 10, 20]} />
    )}
    </div>
  );
}

interface WeekSectionProps {
  week: WeeklyGroup;
  side: TransactionSection;
  open: boolean;
  onToggle: () => void;
  leaseName: (t: Transaction) => string;
  permissions: UserPermissions;
  onSelectTransaction: (t: Transaction) => void;
  onDeleteTransaction: (t: Transaction) => void;
}

function WeekSection({
  week,
  side,
  open,
  onToggle,
  leaseName,
  permissions,
  onSelectTransaction,
  onDeleteTransaction,
}: WeekSectionProps) {
  const isDebit = side === 'debits';
  const items = week.transactions.filter((t) =>
    isDebit ? Number(t.debit_amount ?? 0) > 0 : Number(t.credit_amount ?? 0) > 0,
  );
  const subtotal = items.reduce(
    (s, t) => s + (isDebit ? Number(t.debit_amount) : Number(t.credit_amount)),
    0,
  );

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <span className={`font-semibold text-sm ${isDebit ? 'text-emerald-700' : 'text-orange-700'}`}>
            {isDebit ? 'Debits' : 'Credits'} ({items.length})
          </span>
        </div>
        <span className={`text-sm font-semibold ${isDebit ? 'text-emerald-700' : 'text-orange-700'}`}>
          {formatCurrency(subtotal)}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-4">
          {items.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">No entries</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {items.map((t) => (
                  <tr
                    key={`${t.id}-${t.created_at}-${side}`}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => onSelectTransaction(t)}
                  >
                    <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{formatDate(t.transaction_date)}</td>
                    <td className="py-2 pr-3 text-slate-800">{leaseName(t)}</td>
                    <td className="py-2 pr-3 text-slate-600">{isDebit ? t.account_debited : t.account_credited}</td>
                    <td className="py-2 pr-3 text-slate-600 hidden md:table-cell truncate max-w-[16rem]">
                      {t.description}
                    </td>
                    <td className={`py-2 text-right font-semibold tabular-nums ${isDebit ? 'text-emerald-700' : 'text-orange-700'}`}>
                      {formatCurrency(isDebit ? t.debit_amount : t.credit_amount)}
                    </td>
                    {permissions.delete_leases && (
                      <td className="py-2 pl-2 text-right">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

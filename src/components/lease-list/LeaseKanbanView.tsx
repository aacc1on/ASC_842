import type { Lease } from '../../types/lease';
import { CreditCard as Edit, Trash2, Calendar, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { useToast } from '../toastContextTypes';
import { BalanceInfoTooltip } from '../dashboard/BalanceInfoTooltip';
import { BalanceAmount } from '../BalanceAmount';
import type { BucketTotals, PortfolioTotals } from '../../utils/portfolioTotals';
import { isMissingClassificationData } from '../../utils/leaseLifecycle';
import { MISSING_DATA_TITLE, getRou, getLiab, type LeaseViewProps } from './leaseListHelpers';

interface LeaseKanbanViewProps extends LeaseViewProps {
  portfolioTotals: PortfolioTotals | null;
}

export function LeaseKanbanView({ leases, freqNotice, portfolioTotals, onEdit, onDelete, onViewSchedule, onViewJournalEntries }: LeaseKanbanViewProps) {
  const { confirm: confirmDialog } = useToast();
  const isShortTerm = (l: Lease) => l.accounting_treatment === 'short_term_exemption';
  const allColumns: { key: 'finance' | 'operating' | 'shortTerm'; title: string; headerBg: string; headerBorder: string; chip: string; dot: string; leases: Lease[] }[] = [
    {
      key: 'finance',
      title: 'Finance Leases',
      headerBg: 'bg-emerald-50',
      headerBorder: 'border-emerald-200',
      chip: 'bg-emerald-100 text-emerald-700',
      dot: 'bg-emerald-600',
      leases: leases.filter((l) => !isShortTerm(l) && l.lease_classification === 'finance'),
    },
    {
      key: 'operating',
      title: 'Operating Leases',
      headerBg: 'bg-blue-50',
      headerBorder: 'border-blue-200',
      chip: 'bg-blue-100 text-blue-700',
      dot: 'bg-blue-600',
      leases: leases.filter((l) => !isShortTerm(l) && l.lease_classification !== 'finance'),
    },
    {
      key: 'shortTerm',
      title: 'Short-Term (Exempt)',
      headerBg: 'bg-amber-50',
      headerBorder: 'border-amber-200',
      chip: 'bg-amber-100 text-amber-700',
      dot: 'bg-amber-500',
      leases: leases.filter(isShortTerm),
    },
  ];
  const columns = allColumns.filter(
    (c) => c.key !== 'shortTerm' || c.leases.length > 0 || (portfolioTotals?.shortTerm.count ?? 0) > 0,
  );
  const pageOnly = portfolioTotals === null;

  return (
    <div>
      {freqNotice}
      <div className={`grid grid-cols-1 gap-6 ${columns.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
      {columns.map((col) => {
        const totals: BucketTotals = portfolioTotals
          ? portfolioTotals[col.key]
          : {
              count: col.leases.length,
              rou: col.leases.reduce((s, l) => s + getRou(l), 0),
              liability: col.leases.reduce((s, l) => s + getLiab(l), 0),
            };
        const suffix = pageOnly ? ' (this page)' : '';
        const hiddenCount = totals.count - col.leases.length;
        return (
          <div key={col.key} data-testid={`kanban-column-${col.key}`} className={`border ${col.headerBorder} rounded-xl bg-slate-50/40`}>
            <div className={`${col.headerBg} border-b ${col.headerBorder} px-5 py-4 rounded-t-xl`}>
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`}></span>
                <h4 className="text-base font-bold text-slate-900">{col.title}</h4>
                <span
                  data-testid="kanban-column-count"
                  className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full text-xs font-bold ${col.chip}`}
                >
                  {totals.count}
                </span>
                {col.key === 'finance' && <BalanceInfoTooltip />}
              </div>
              <div className="flex items-center gap-6 mt-3 text-xs">
                <div>
                  <p className="text-slate-500 font-medium uppercase tracking-wide">ROU Total{suffix}</p>
                  <p data-testid="kanban-column-rou" className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(totals.rou)}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-medium uppercase tracking-wide">Liability Total{suffix}</p>
                  <p data-testid="kanban-column-liability" className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(totals.liability)}</p>
                </div>
              </div>
              {!pageOnly && hiddenCount > 0 && (
                <p className="text-xs text-slate-500 mt-2">
                  Totals cover all {totals.count} matching leases; {col.leases.length} shown on this page.
                </p>
              )}
            </div>
            <div className="p-4 space-y-3 max-h-[720px] overflow-y-auto rounded-b-xl">
              {col.leases.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-500">
                  {totals.count > 0 ? 'No leases from this category on this page' : 'No leases in this category'}
                </div>
              ) : (
                col.leases.map((lease) => (
                  <div key={lease.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-slate-300 transition-all">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h5 className="text-sm font-bold text-slate-900 leading-tight truncate">{lease.lease_name}</h5>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{lease.lessor_name}</p>
                        {lease.is_complete === false && (
                          <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700" title="This lease was not fully saved. Edit to finish or delete it.">
                            Incomplete
                          </span>
                        )}
                        {isMissingClassificationData(lease) && (
                          <span className="inline-flex mt-1 ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700" title={MISSING_DATA_TITLE}>
                            Missing classification data
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formatDate(lease.lease_start_date)}</span>
                      </div>
                      <div className="text-slate-500 text-right">{lease.lease_term_months} mo</div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">ROU Asset</p>
                        <p className="text-sm font-semibold text-slate-900 mt-0.5"><BalanceAmount lease={lease} kind="rou" /></p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Liability</p>
                        <p className="text-sm font-semibold text-slate-900 mt-0.5"><BalanceAmount lease={lease} kind="liability" /></p>
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5 text-slate-600 pt-2 border-t border-slate-100 mt-1">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span className="text-xs">Monthly:</span>
                        <span className="text-xs font-semibold text-slate-900">{formatCurrency(lease.payment_amount)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => onViewSchedule(lease)}
                        className="flex-1 px-2 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition"
                        aria-label="View amortization schedule"
                      >
                        Schedule
                      </button>
                      {onViewJournalEntries && (
                        <button
                          onClick={() => onViewJournalEntries(lease)}
                          className="flex-1 px-2 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded transition"
                          aria-label="View journal entries"
                        >
                          Journals
                        </button>
                      )}
                      {onEdit && (
                        <button
                          onClick={() => onEdit(lease)}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded transition"
                          title="Edit"
                          aria-label="Edit lease"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => {
                            confirmDialog({ message: 'Are you sure you want to delete this lease?', confirmLabel: 'Delete', destructive: true }).then(ok => { if (ok) onDelete(lease.id); });
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                          title="Delete"
                          aria-label="Delete lease"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

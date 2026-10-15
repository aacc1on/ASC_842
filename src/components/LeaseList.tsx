import { useState } from 'react';
import { Lease } from '../types/lease';
import { FileText, Calendar, DollarSign, TrendingUp, CreditCard as Edit3, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils/formatting';
import { useToast } from './toastContextTypes';
import { BalanceAmount } from './BalanceAmount';
import type { PortfolioTotals } from '../utils/portfolioTotals';
import { isMissingClassificationData } from '../utils/leaseLifecycle';

import { MISSING_DATA_TITLE, formatLessorType, nextSort, type SortKey, type SortDir } from './lease-list/leaseListHelpers';
import { LeaseTableView } from './lease-list/LeaseTableView';
import { LeaseKanbanView } from './lease-list/LeaseKanbanView';

interface LeaseListProps {
  leases: Lease[];
  viewMode?: 'cards' | 'table' | 'kanban';
  /** Totals for every lease matching the current filters; null falls back to this page's leases. */
  portfolioTotals?: PortfolioTotals | null;
  onEdit?: (lease: Lease) => void;
  onDelete?: (id: string) => void;
  onViewSchedule: (lease: Lease) => void;
  onViewJournalEntries?: (lease: Lease) => void;
  userRole?: string;
}

export function LeaseList({ leases, viewMode = 'cards', portfolioTotals = null, onEdit, onDelete, onViewSchedule, onViewJournalEntries, userRole }: LeaseListProps) {
  const { confirm: confirmDialog } = useToast();

  const [sortKey, setSortKey] = useState<SortKey>('lease_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    const next = nextSort({ key: sortKey, dir: sortDir }, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  if (leases.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-slate-700 mb-2">No leases yet</h3>
        <p className="text-slate-500">Get started by creating your first lease</p>
      </div>
    );
  }

  const nonMonthlyLeases = leases.filter((l) => l.payment_frequency && l.payment_frequency !== 'monthly');
  const showFreqNotice = (userRole === 'admin' || userRole === 'manage') && nonMonthlyLeases.length > 0;

  const freqNotice = showFreqNotice && (
    <div className="mb-4 bg-orange-50 border border-orange-300 rounded-lg px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-orange-800">
          {nonMonthlyLeases.length} lease{nonMonthlyLeases.length === 1 ? '' : 's'} with non-monthly payment frequency
        </p>
        <p className="text-xs text-orange-700 mt-0.5">
          Measured before the payment-frequency fix. Re-save if no accounting is posted; otherwise record a correction.
        </p>
      </div>
    </div>
  );

  if (viewMode === 'table') {
    return (
      <LeaseTableView
        leases={leases} freqNotice={freqNotice} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
        onEdit={onEdit} onDelete={onDelete} onViewSchedule={onViewSchedule} onViewJournalEntries={onViewJournalEntries}
      />
    );
  }

  if (viewMode === 'kanban') {
    return (
      <LeaseKanbanView
        leases={leases} freqNotice={freqNotice} portfolioTotals={portfolioTotals}
        onEdit={onEdit} onDelete={onDelete} onViewSchedule={onViewSchedule} onViewJournalEntries={onViewJournalEntries}
      />
    );
  }

    return (
      <div>
        {freqNotice}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {leases.map((lease) => (
        <div
          key={lease.id}
          className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900 mb-1">{lease.lease_name}</h3>
                <p className="text-sm text-slate-500">{lease.lessor_name}</p>
                <p className="text-xs text-slate-500 mt-1">{formatLessorType(lease.lessor_type)}</p>
                {isMissingClassificationData(lease) && (
                  <span className="inline-flex mt-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700" title={MISSING_DATA_TITLE}>
                    Missing classification data
                  </span>
                )}
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  lease.lease_classification === 'finance'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {lease.lease_classification}
              </span>
              {lease.is_complete === false && (
                <span className="ml-1 px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700" title="This lease was not fully saved. Edit to finish or delete it.">
                  Incomplete
                </span>
              )}
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">
                  {formatDate(lease.lease_start_date)} - {formatDate(lease.lease_end_date)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">
                  {formatCurrency(lease.payment_amount)}/month
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">
                  {lease.lease_term_months} months
                </span>
              </div>
            </div>

            {lease.modifications && lease.modifications.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Edit3 className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-900">Approved Modifications</h4>
                </div>
                <div className="space-y-2 mb-4">
                  {lease.modifications.map((mod) => (
                    <div key={mod.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-semibold text-blue-700 uppercase">
                          {mod.modification_type.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDate(mod.modification_date)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{mod.reason}</p>
                      <div className="space-y-1">
                        {mod.old_monthly_payment !== mod.new_monthly_payment && (
                          <div className="text-xs text-slate-700">
                            Payment: {formatCurrency(mod.old_monthly_payment)} → {formatCurrency(mod.new_monthly_payment)}
                          </div>
                        )}
                        {mod.old_lease_term !== mod.new_lease_term && (
                          <div className="text-xs text-slate-700">
                            Term: {mod.old_lease_term} → {mod.new_lease_term} months
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">ROU Asset</p>
                  <p className="text-sm font-semibold text-slate-900">
                    <BalanceAmount lease={lease} kind="rou" />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Lease Liability</p>
                  <p className="text-sm font-semibold text-slate-900">
                    <BalanceAmount lease={lease} kind="liability" />
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => onViewSchedule(lease)}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
                  >
                    Schedule
                  </button>
                  {onViewJournalEntries && (
                    <button
                      onClick={() => onViewJournalEntries(lease)}
                      className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition"
                    >
                      Journals
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(lease)}
                      className="flex-1 px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition text-sm font-semibold"
                    >
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => {
                        confirmDialog({ message: 'Are you sure you want to delete this lease?', confirmLabel: 'Delete', destructive: true }).then(ok => { if (ok) onDelete(lease.id); });
                      }}
                      className="flex-1 px-3 py-2 border border-red-300 hover:bg-red-50 text-red-600 rounded-lg transition text-sm font-semibold"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

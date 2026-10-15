import { CreditCard as Edit, Trash2, Calendar, BookOpen, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { useToast } from '../toastContextTypes';
import { BalanceAmount } from '../BalanceAmount';
import { isMissingClassificationData } from '../../utils/leaseLifecycle';
import { MISSING_DATA_TITLE, formatLessorType, formatNullableCurrency, LEASE_TABLE_COLUMNS, sortLeases, type LeaseViewProps, type SortKey, type SortDir, type EnrichedLease } from './leaseListHelpers';

interface LeaseTableViewProps extends LeaseViewProps {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

export function LeaseTableView({ leases, freqNotice, sortKey, sortDir, onSort, onEdit, onDelete, onViewSchedule, onViewJournalEntries }: LeaseTableViewProps) {
  const { confirm: confirmDialog } = useToast();
  const sortedLeases = sortLeases(leases, sortKey, sortDir);
  const columns = LEASE_TABLE_COLUMNS;

  return (
    <div>
      {freqNotice}
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="w-full">
        <thead className="bg-slate-100 border-b border-slate-200">
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className={`px-4 py-3 text-xs font-bold text-slate-700 uppercase whitespace-nowrap cursor-pointer select-none hover:bg-slate-200 transition-colors ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
              >
                <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 opacity-40" />
                  )}
                </span>
              </th>
            ))}
            <th className="px-4 py-3 text-center text-xs font-bold text-slate-700 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {sortedLeases.map((lease, index) => (
            <tr key={lease.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{lease.lease_name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-700">{lease.lessor_name}</div>
                <div className="text-xs text-slate-500">{formatLessorType(lease.lessor_type)}</div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {(lease as EnrichedLease).fixed_asset_types?.type_name ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                    {(lease as EnrichedLease).fixed_asset_types!.type_name.trim()}
                    {(lease as EnrichedLease).fixed_asset_types!.type_code ? (
                      <span className="text-slate-500">({(lease as EnrichedLease).fixed_asset_types!.type_code})</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-slate-300 text-sm">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${lease.lease_classification === 'finance' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                  {lease.lease_classification}
                </span>
                {lease.accounting_treatment === 'short_term_exemption' && (
                  <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    Short-Term Exempt
                  </span>
                )}
                {lease.is_complete === false && (
                  <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700" title="This lease was not fully saved. Edit to finish or delete it.">
                    Incomplete — finish or delete
                  </span>
                )}
                {isMissingClassificationData(lease) && (
                  <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 whitespace-nowrap" title={MISSING_DATA_TITLE}>
                    Missing classification data
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{formatDate(lease.lease_start_date)}</td>
              <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{formatDate(lease.lease_end_date)}</td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">{lease.lease_term_months}</td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium whitespace-nowrap">{formatCurrency(lease.payment_amount)}</td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium whitespace-nowrap">{formatNullableCurrency(lease.initial_direct_costs ?? 0)}</td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium whitespace-nowrap">{formatNullableCurrency(lease.residual_value_guarantee ?? 0)}</td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium"><BalanceAmount lease={lease} kind="rou" /></td>
              <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium"><BalanceAmount lease={lease} kind="liability" /></td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => onViewSchedule(lease)}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                    title="View schedule"
                    aria-label="View amortization schedule"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                  {onViewJournalEntries && (
                    <button
                      onClick={() => onViewJournalEntries(lease)}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                      title="Journal entries"
                      aria-label="View journal entries"
                    >
                      <BookOpen className="w-4 h-4" />
                    </button>
                  )}
                  {onEdit && (
                    <button
                      onClick={() => onEdit(lease)}
                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded transition"
                      title="Edit"
                      aria-label="Edit lease"
                    >
                      <Edit className="w-4 h-4" />
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
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

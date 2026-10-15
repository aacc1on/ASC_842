import { X, Calendar, BookOpen, CreditCard as Edit, Trash2 } from 'lucide-react';
import type { Lease } from '../../types/lease';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { useToast } from '../toastContextTypes';
import { BalanceAmount } from '../BalanceAmount';

interface FullscreenTableProps {
  leases: Lease[];
  onEdit?: (lease: Lease) => void;
  onDelete?: (id: string) => void;
  onViewSchedule: (lease: Lease) => void;
  onViewJournalEntries?: (lease: Lease) => void;
  onExit: () => void;
}

interface EnrichedLease extends Lease {
  currentBalances?: Lease['currentBalances'];
  fixed_asset_types?: { type_name: string; type_code: string } | null;
}

const formatLessorType = (type: string) => {
  const types: Record<string, string> = {
    corporate: 'Corporate',
    individual: 'Individual',
    government: 'Government',
    financial_institution: 'Financial Institution',
    other: 'Other',
  };
  return types[type] || type;
};

export function FullscreenTable({
  leases,
  onEdit,
  onDelete,
  onViewSchedule,
  onViewJournalEntries,
  onExit,
}: FullscreenTableProps) {
  const { confirm: confirmDialog } = useToast();


  const columns: { key: string; label: string; align: 'left' | 'right' }[] = [
    { key: 'lease_name', label: 'Lease', align: 'left' },
    { key: 'lessor_name', label: 'Lessor', align: 'left' },
    { key: 'fixed_asset_type', label: 'Asset Type', align: 'left' },
    { key: 'lease_classification', label: 'Type', align: 'left' },
    { key: 'lease_start_date', label: 'Start', align: 'left' },
    { key: 'lease_end_date', label: 'End', align: 'left' },
    { key: 'lease_term_months', label: 'Term (mo)', align: 'right' },
    { key: 'payment_amount', label: 'Monthly', align: 'right' },
    { key: 'rou_asset', label: 'ROU', align: 'right' },
    { key: 'liability', label: 'Liability', align: 'right' },
  ];

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-900">Lease Portfolio — Fullscreen</h2>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          title="Exit fullscreen (Esc)"
          aria-label="Exit fullscreen"
        >
          <X className="w-5 h-5" />
          Exit
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {leases.length === 0 ? (
          <div className="text-center py-20 text-slate-500">No leases to display.</div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full">
              <thead className="bg-slate-100 border-b border-slate-200 sticky top-0">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 text-xs font-bold text-slate-700 uppercase whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-700 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {leases.map((lease, index) => (
                  <tr key={lease.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 whitespace-nowrap">
                      {lease.lease_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-slate-700">{lease.lessor_name}</div>
                      <div className="text-xs text-slate-500">{formatLessorType(lease.lessor_type)}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(lease as EnrichedLease).fixed_asset_types?.type_name ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                          {(lease as EnrichedLease).fixed_asset_types!.type_name.trim()}
                          {(lease as EnrichedLease).fixed_asset_types!.type_code ? (
                            <span className="text-slate-500">
                              ({(lease as EnrichedLease).fixed_asset_types!.type_code})
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                          lease.lease_classification === 'finance'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {lease.lease_classification}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {formatDate(lease.lease_start_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {formatDate(lease.lease_end_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      {lease.lease_term_months}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium whitespace-nowrap">
                      {formatCurrency(lease.payment_amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      <BalanceAmount lease={lease} kind="rou" />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      <BalanceAmount lease={lease} kind="liability" />
                    </td>
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
                              confirmDialog({
                                message: 'Are you sure you want to delete this lease?',
                                confirmLabel: 'Delete',
                                destructive: true,
                              }).then((ok) => {
                                if (ok) onDelete(lease.id);
                              });
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
        )}
      </div>
    </div>
  );
}

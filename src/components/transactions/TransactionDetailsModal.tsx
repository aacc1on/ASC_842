import { X, RotateCcw, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import type { Lease } from '../../types/lease';
import type { UserPermissions } from '../../App';
import type { Transaction } from './types';

interface TransactionDetailsModalProps {
  transaction: Transaction;
  leases: Lease[];
  permissions: UserPermissions;
  onClose: () => void;
  onReverse: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
}

export function TransactionDetailsModal({
  transaction,
  leases,
  permissions,
  onClose,
  onReverse,
  onDelete,
}: TransactionDetailsModalProps) {
  const leaseName =
    transaction.lease_name ??
    leases.find((l) => l.id === transaction.lease_id)?.lease_name ??
    'Unknown Lease';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Transaction Details</h2>
          <button onClick={onClose} aria-label="Close transaction details" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <DetailRow label="Lease" value={leaseName} />
          <DetailRow label="Date" value={formatDate(transaction.transaction_date)} />
          <DetailRow label="Period" value={transaction.period || '—'} />
          <DetailRow
            label="Type"
            value={transaction.transaction_type.replace(/_/g, ' ')}
          />
          <DetailRow label="Reference" value={transaction.reference_number || '—'} />
          {transaction.branch_name && (
            <DetailRow label="Branch" value={transaction.branch_name} />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-emerald-700 uppercase">Debit</p>
              <p className="text-lg font-bold text-emerald-900 mt-1">
                {formatCurrency(transaction.debit_amount)}
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">{transaction.account_debited || '—'}</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-700 uppercase">Credit</p>
              <p className="text-lg font-bold text-orange-900 mt-1">
                {formatCurrency(transaction.credit_amount)}
              </p>
              <p className="text-xs text-orange-700 mt-0.5">{transaction.account_credited || '—'}</p>
            </div>
          </div>

          {transaction.description && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Description</p>
              <p className="text-sm text-slate-700">{transaction.description}</p>
            </div>
          )}

          {transaction.is_reversed && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              This transaction has been reversed.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Close
          </button>
          {permissions.create_transactions && !transaction.is_reversed && (
            <button
              onClick={() => onReverse(transaction)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition"
            >
              <RotateCcw className="w-4 h-4" />
              Reverse
            </button>
          )}
          {permissions.delete_leases && (
            <button
              onClick={() => onDelete(transaction)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-semibold text-slate-500">{label}</span>
      <span className="text-sm text-slate-900 text-right">{value}</span>
    </div>
  );
}

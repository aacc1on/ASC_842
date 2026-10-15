import { Plus, CalendarClock } from 'lucide-react';
import type { UserPermissions } from '../../App';

interface TransactionsHeaderProps {
  permissions: UserPermissions;
  onOpenMonthEndModal: () => void;
  onAddTransaction: () => void;
}

export function TransactionsHeader({
  permissions,
  onOpenMonthEndModal,
  onAddTransaction,
}: TransactionsHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Transactions</h1>
        <p className="text-slate-500 mt-1">Lease journal entries and month-end postings</p>
      </div>
      <div className="flex gap-3">
        {permissions.run_month_end && (
          <button
            onClick={onOpenMonthEndModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg transition shadow-sm"
          >
            <CalendarClock className="w-4 h-4" />
            Month-End
          </button>
        )}
        {permissions.create_transactions && (
          <button
            onClick={onAddTransaction}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        )}
      </div>
    </div>
  );
}

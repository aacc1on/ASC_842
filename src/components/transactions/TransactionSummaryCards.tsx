import { ArrowDownCircle, ArrowUpCircle, Receipt } from 'lucide-react';
import { formatCurrency } from '../../utils/formatting';

interface TransactionSummaryCardsProps {
  effectiveCount: number;
  totalDebits: number;
  totalCredits: number;
}

export function TransactionSummaryCards({
  effectiveCount,
  totalDebits,
  totalCredits,
}: TransactionSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Transactions</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{effectiveCount}</p>
          </div>
          <Receipt className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">Total Debits</p>
            <p className="text-2xl font-bold text-emerald-900 mt-1">{formatCurrency(totalDebits)}</p>
          </div>
          <ArrowDownCircle className="w-8 h-8 text-emerald-500" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-orange-700">Total Credits</p>
            <p className="text-2xl font-bold text-orange-900 mt-1">{formatCurrency(totalCredits)}</p>
          </div>
          <ArrowUpCircle className="w-8 h-8 text-orange-500" />
        </div>
      </div>
    </div>
  );
}

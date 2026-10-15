import { X, Calendar } from 'lucide-react';
import { LeaseBreakdownItem } from '../utils/financialReports';
import { formatCurrency, parseLocalDate } from '../utils/formatting';

interface BreakdownPanelProps {
  title: string;
  total: number;
  items: LeaseBreakdownItem[];
  isNegative?: boolean;
  onClose: () => void;
}

export function BreakdownPanel({ title, total, items, isNegative = false, onClose }: BreakdownPanelProps) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    return parseLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const sorted = [...items].sort((a, b) => b.value - a.value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-white font-bold text-lg">{title}</h3>
            <p className="text-blue-100 text-sm mt-0.5">Per-lease breakdown</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Total</span>
            <span className={`text-2xl font-bold ${isNegative ? 'text-red-600' : 'text-slate-900'}`}>
              {isNegative ? `(${formatCurrency(total)})` : formatCurrency(total)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{sorted.length} lease{sorted.length !== 1 ? 's' : ''} contributing</p>
        </div>

        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-12 text-slate-500">
            <p className="text-sm">No lease contributions for this period</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-slate-100">
              {sorted.map((item, idx) => {
                const pct = total > 0 ? (item.value / total) * 100 : 0;
                return (
                  <div key={item.leaseId} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{item.leaseName}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                                item.classification === 'finance'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-orange-100 text-orange-700'
                              }`}
                            >
                              {item.classification === 'finance' ? 'Finance' : 'Operating'}
                            </span>
                            {formatDate(item.transactionDate) && (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                <Calendar className="w-3 h-3" />
                                {formatDate(item.transactionDate)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-sm ${isNegative ? 'text-red-600' : 'text-slate-900'}`}>
                          {isNegative ? `(${formatCurrency(item.value)})` : formatCurrency(item.value)}
                        </p>
                        <p className="text-xs text-slate-500">{pct.toFixed(1)}%</p>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${item.classification === 'finance' ? 'bg-blue-500' : 'bg-orange-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex-shrink-0">
          <p className="text-xs text-slate-500 text-center">Click outside or press the X to close</p>
        </div>
      </div>
    </div>
  );
}

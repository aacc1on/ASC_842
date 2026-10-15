import {
  FileSpreadsheet, ChevronDown, ChevronRight, Trash2, Loader, Calendar,
  TrendingUp, DollarSign, BarChart3, Wallet,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatting';
import type { MonthEndDocument } from './monthEndDocHelpers';

interface MonthEndDocumentSummaryProps {
  doc: MonthEndDocument;
  isExpanded: boolean;
  isDeletingThis: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

export function MonthEndDocumentSummary({ doc, isExpanded, isDeletingThis, onToggle, onDelete }: MonthEndDocumentSummaryProps) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4">
        <button
          onClick={onToggle}
          className="flex items-center gap-4 flex-1 text-left group"
        >
          <div className="bg-blue-100 p-3 rounded-xl flex-shrink-0">
            <FileSpreadsheet className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-bold text-slate-900">{doc.period_label}</h3>
              <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                doc.status === 'posted'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <Calendar className="w-3.5 h-3.5" />
              <span>Posted {formatDate(doc.created_at)}</span>
            </div>
          </div>

          <div className="hidden md:grid grid-cols-4 gap-6 text-center flex-shrink-0">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 justify-center mb-0.5">
                <TrendingUp className="w-3.5 h-3.5" />
                Interest
              </div>
              <div className="text-sm font-bold text-orange-700">{formatCurrency(doc.total_interest)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 justify-center mb-0.5">
                <BarChart3 className="w-3.5 h-3.5" />
                Depreciation
              </div>
              <div className="text-sm font-bold text-green-700">{formatCurrency(doc.total_depreciation)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 justify-center mb-0.5">
                <Wallet className="w-3.5 h-3.5" />
                Cash paid
              </div>
              <div className="text-sm font-bold text-slate-800">{formatCurrency(doc.total_principal)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 justify-center mb-0.5">
                <DollarSign className="w-3.5 h-3.5" />
                {doc.transaction_count} entries
              </div>
              <div className="text-sm font-bold text-blue-700">{doc.lease_count} leases</div>
            </div>
          </div>

          <div className="text-slate-500 group-hover:text-slate-600 transition flex-shrink-0">
            {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </div>
        </button>

        <button
          onClick={onDelete}
          disabled={isDeletingThis}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 border border-red-200 hover:border-red-300 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {isDeletingThis ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          Delete
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 md:hidden gap-3">
        <div className="bg-orange-50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Interest</div>
          <div className="text-sm font-bold text-orange-700">{formatCurrency(doc.total_interest)}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Depreciation</div>
          <div className="text-sm font-bold text-green-700">{formatCurrency(doc.total_depreciation)}</div>
        </div>
        <div className="col-span-2 bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Cash paid</div>
          <div className="text-sm font-bold text-slate-800">{formatCurrency(doc.total_principal)}</div>
        </div>
      </div>
    </div>
  );
}

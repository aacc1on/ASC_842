import { Plus, Trash2 } from 'lucide-react';
import type { PaymentTrancheRow, ScheduleCoverage } from './types';

interface VariablePaymentsEditorProps {
  paymentTranches: PaymentTrancheRow[];
  termMonths: number;
  coverage: ScheduleCoverage;
  isFullyCovered: boolean;
  hasGaps: boolean;
  onAddTranche: () => void;
  onRemoveTranche: (id: string) => void;
  onUpdateTranche: (id: string, field: keyof PaymentTrancheRow, value: string | number) => void;
}

const inputClass =
  'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

export function VariablePaymentsEditor({
  paymentTranches,
  termMonths,
  coverage,
  isFullyCovered,
  hasGaps,
  onAddTranche,
  onRemoveTranche,
  onUpdateTranche,
}: VariablePaymentsEditorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Payment Tranches</span>
        <button
          type="button"
          onClick={onAddTranche}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          Add Tranche
        </button>
      </div>

      {coverage.total > 0 && (
        <div
          className={`text-xs px-3 py-2 rounded-lg ${
            isFullyCovered
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : hasGaps
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-slate-50 text-slate-600 border border-slate-200'
          }`}
        >
          {isFullyCovered
            ? `All ${coverage.total} months covered by tranches.`
            : hasGaps
              ? `Coverage: ${coverage.covered} of ${coverage.total} months. Fill the gaps for an accurate liability.`
              : `Coverage: ${coverage.covered} of ${coverage.total} months.`}
        </div>
      )}

      {paymentTranches.length === 0 ? (
        <p className="text-sm text-slate-500">No tranches yet. Add one to define variable payments.</p>
      ) : (
        <div className="space-y-2">
          {paymentTranches.map((tranche) => (
            <div
              key={tranche.id}
              className="grid grid-cols-12 gap-2 items-center p-2 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <div className="col-span-3">
                <label className="text-[10px] font-semibold text-slate-500 uppercase">From</label>
                <input
                  type="number"
                  min={1}
                  value={tranche.fromMonth}
                  onChange={(e) => onUpdateTranche(tranche.id, 'fromMonth', parseInt(e.target.value) || 1)}
                  className={inputClass}
                />
              </div>
              <div className="col-span-3">
                <label className="text-[10px] font-semibold text-slate-500 uppercase">To</label>
                <input
                  type="number"
                  min={tranche.fromMonth}
                  value={tranche.toMonth}
                  onChange={(e) => onUpdateTranche(tranche.id, 'toMonth', parseInt(e.target.value) || tranche.fromMonth)}
                  className={inputClass}
                />
              </div>
              <div className="col-span-5">
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Amount</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={tranche.paymentAmount}
                  onChange={(e) => onUpdateTranche(tranche.id, 'paymentAmount', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => onRemoveTranche(tranche.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                  title="Remove tranche"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {termMonths > 0 && (
        <p className="text-xs text-slate-500">
          Lease term is {termMonths} months. Tranches should cover months 1–{termMonths}.
        </p>
      )}
    </div>
  );
}

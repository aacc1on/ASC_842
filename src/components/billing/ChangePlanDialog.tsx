import { useEffect } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import type { PlanChangePreview } from '../../utils/billingApi';
import { formatCurrency } from '../../utils/formatting';

interface ChangePlanDialogProps {
  preview: PlanChangePreview;
  confirming: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ChangePlanDialog({ preview, confirming, onConfirm, onClose }: ChangePlanDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirming) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, onClose]);

  const cycleLabel = preview.billing_cycle === 'annually' ? 'annual' : 'monthly';
  const credit = preview.total < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => !confirming && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-plan-title"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100">
              <ArrowRightLeft className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 id="change-plan-title" className="text-lg font-bold text-slate-900">Switch to {preview.plan_name}</h2>
              <p className="text-sm text-slate-500">Billed {cycleLabel === 'annual' ? 'annually' : 'monthly'}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={confirming} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            {credit ? 'Credit for unused time' : 'Charged now'}
          </p>
          <p className="text-3xl font-bold text-slate-900">
            {formatCurrency(Math.abs(credit ? preview.total : preview.amount_due) / 100)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {credit
              ? 'This credit is applied automatically to your future invoices.'
              : 'Prorated for the rest of your current billing period, charged to your card on file.'}
          </p>
        </div>

        {preview.lines.length > 0 && (
          <ul className="space-y-2 mb-5 max-h-40 overflow-y-auto">
            {preview.lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-4 text-sm">
                <span className="text-slate-600">{line.description ?? 'Adjustment'}</span>
                <span className={`font-semibold tabular-nums ${line.amount < 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {line.amount < 0 ? '-' : ''}{formatCurrency(Math.abs(line.amount) / 100)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onClose} disabled={confirming} className="flex-1 px-5 py-2.5 bg-white text-slate-700 text-sm font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">
            Keep current plan
          </button>
          <button onClick={onConfirm} disabled={confirming} className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-60">
            {confirming && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Confirm switch
          </button>
        </div>
      </div>
    </div>
  );
}

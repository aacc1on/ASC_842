import { useRef, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { ModificationFormData, ModificationRow, RemeasurementPreview } from './types';

interface ModificationFormModalProps {
  show: boolean;
  editingMod: ModificationRow | null;
  leases: Lease[];
  modForm: ModificationFormData;
  setModForm: React.Dispatch<React.SetStateAction<ModificationFormData>>;
  preview: RemeasurementPreview | null;
  canPreview: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
  onLeaseChange: (id: string) => void;
  onDateChange: (date: string) => void;
  onPaymentChange: (value: number) => void;
  onTermChange: (value: number) => void;
  onRateChange: (value: number) => void;
  onRefreshPreview: () => void;
}

const TYPE_OPTIONS = [
  'term_extension',
  'term_reduction',
  'payment_change',
  'scope_change',
  'discount_rate_change',
  'other',
];

export function ModificationFormModal({
  show,
  editingMod,
  leases,
  modForm,
  setModForm,
  preview,
  canPreview,
  onClose,
  onSubmit,
  onLeaseChange,
  onDateChange,
  onPaymentChange,
  onTermChange,
  onRateChange,
  onRefreshPreview,
}: ModificationFormModalProps) {
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  if (!show) return null;

  const update = <K extends keyof ModificationFormData>(field: K, value: ModificationFormData[K]) => {
    setLocalError('');
    setModForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBeforeSubmit = (e: React.FormEvent) => {
    if (!modForm.lease_id) {
      e.preventDefault();
      setLocalError('Please select a lease.');
      return;
    }
    if (!modForm.modification_date) {
      e.preventDefault();
      setLocalError('Please select a modification date.');
      return;
    }
    if (submittingRef.current) {
      e.preventDefault();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    Promise.resolve(onSubmit(e)).finally(() => {
      submittingRef.current = false;
      setSubmitting(false);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {editingMod ? 'Edit Modification' : 'New Modification'}
          </h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleBeforeSubmit} className="px-6 py-5 space-y-4">
          {localError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {localError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Lease</label>
              <select
                value={modForm.lease_id}
                onChange={(e) => onLeaseChange(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              >
                <option value="">Select a lease…</option>
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lease_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Modification Date</label>
              <input
                type="date"
                value={modForm.modification_date}
                onChange={(e) => onDateChange(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={modForm.modification_type}
                onChange={(e) => update('modification_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Accounting Treatment</label>
              <select
                value={modForm.accounting_treatment}
                onChange={(e) => update('accounting_treatment', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="remeasurement">Remeasurement</option>
                <option value="separate_lease">Separate Lease</option>
                <option value="partial_termination">Partial Termination</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reason</label>
            <textarea
              value={modForm.reason}
              onChange={(e) => update('reason', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Describe the reason for the modification"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">New Monthly Payment</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={modForm.new_monthly_payment}
                onChange={(e) => onPaymentChange(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">New Term (months)</label>
              <input
                type="number"
                min="0"
                value={modForm.new_lease_term}
                onChange={(e) => onTermChange(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">New Discount Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={modForm.new_discount_rate}
                onChange={(e) => onRateChange(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="remeasurement_required"
              checked={modForm.remeasurement_required}
              onChange={(e) => update('remeasurement_required', e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="remeasurement_required" className="text-sm text-slate-700">
              Remeasurement required
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="separate_contract"
              checked={modForm.separate_contract}
              onChange={(e) => update('separate_contract', e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="separate_contract" className="text-sm text-slate-700">
              Grants an additional right of use priced at its standalone price
            </label>
          </div>

          {modForm.separate_contract && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              This modification grants a separate right of use and should be accounted for as a new lease. No remeasurement is performed.
              <button
                type="button"
                className="ml-2 text-amber-900 font-semibold underline hover:text-amber-700"
                onClick={() => {
                  const event = new CustomEvent('open-new-lease-from-mod', { detail: { leaseId: modForm.lease_id } });
                  window.dispatchEvent(event);
                }}
              >
                Account for this as a separate new lease
              </button>
            </div>
          )}

          {!modForm.separate_contract && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Reassess Classification</label>
                <select
                  value={modForm.new_classification}
                  onChange={(e) => update('new_classification', e.target.value as 'operating' | 'finance')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="operating">Operating</option>
                  <option value="finance">Finance</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Fair Value at Mod Date</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={modForm.new_fair_value ?? ''}
                  onChange={(e) => update('new_fair_value', e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Remaining Economic Life (months)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={modForm.new_economic_life_months ?? ''}
                  onChange={(e) => update('new_economic_life_months', e.target.value === '' ? null : Math.round(Number(e.target.value)))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="0"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Notes</label>
            <textarea
              value={modForm.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Optional notes"
            />
          </div>

          {/* Remeasurement preview */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-blue-900">Remeasurement Preview</h3>
              <button
                type="button"
                onClick={onRefreshPreview}
                disabled={!canPreview}
                className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {preview ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">New ROU Asset:</span>
                  <span className="font-semibold text-slate-900">
                    ${Number(preview.new_rou_asset).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">New Liability:</span>
                  <span className="font-semibold text-slate-900">
                    ${Number(preview.new_lease_liability).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">ROU Adjustment:</span>
                  <span
                    className={`font-semibold ${preview.rou_adjustment >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {preview.rou_adjustment >= 0 ? '+' : ''}
                    ${Number(preview.rou_adjustment).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Liability Adjustment:</span>
                  <span
                    className={`font-semibold ${preview.liability_adjustment >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {preview.liability_adjustment >= 0 ? '+' : ''}
                    ${Number(preview.liability_adjustment).toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Select a lease and enter the new payment and term, then click Refresh to preview the
                remeasurement impact.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : editingMod ? 'Update Modification' : 'Create Modification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

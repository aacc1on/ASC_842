import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { CancellationFormData, CancellationRow } from './types';

interface CancellationModalProps {
  show: boolean;
  editingCan: CancellationRow | null;
  leases: Lease[];
  canForm: CancellationFormData;
  setCanForm: React.Dispatch<React.SetStateAction<CancellationFormData>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
}

export function CancellationModal({
  show,
  editingCan,
  leases,
  canForm,
  setCanForm,
  onClose,
  onSubmit,
}: CancellationModalProps) {
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  if (!show) return null;

  const update = <K extends keyof CancellationFormData>(field: K, value: CancellationFormData[K]) => {
    setLocalError('');
    setCanForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBeforeSubmit = (e: React.FormEvent) => {
    if (!canForm.lease_id) {
      e.preventDefault();
      setLocalError('Please select a lease.');
      return;
    }
    if (!canForm.cancellation_reason.trim()) {
      e.preventDefault();
      setLocalError('Please provide a cancellation reason.');
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {editingCan ? 'Edit Cancellation' : 'Cancel Contract'}
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

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Lease</label>
            <select
              value={canForm.lease_id}
              onChange={(e) => update('lease_id', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
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
            <label className="block text-sm font-semibold text-slate-700 mb-1">Cancellation Date</label>
            <input
              type="date"
              value={canForm.cancellation_date}
              onChange={(e) => update('cancellation_date', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reason</label>
            <textarea
              value={canForm.cancellation_reason}
              onChange={(e) => update('cancellation_reason', e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
              placeholder="Describe the reason for cancellation"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="early_termination"
              checked={canForm.early_termination}
              onChange={(e) => update('early_termination', e.target.checked)}
              className="rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            <label htmlFor="early_termination" className="text-sm text-slate-700">
              Early termination
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Termination Penalty</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={canForm.termination_penalty}
                onChange={(e) => update('termination_penalty', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Final Payment Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={canForm.final_payment_amount}
                onChange={(e) => update('final_payment_amount', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Settlement Details</label>
            <textarea
              value={canForm.settlement_details}
              onChange={(e) => update('settlement_details', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
              placeholder="Optional settlement details"
            />
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
              className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : editingCan ? 'Update Cancellation' : 'Submit Cancellation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { ContractModificationForm } from './contractModHelpers';

interface ModificationFormModalProps {
  show: boolean;
  editing: boolean;
  submitting: boolean;
  leases: Lease[];
  form: ContractModificationForm;
  onFormChange: React.Dispatch<React.SetStateAction<ContractModificationForm>>;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
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
  editing,
  submitting,
  leases,
  form,
  onFormChange,
  onSubmit,
  onClose,
}: ModificationFormModalProps) {
  const [localError, setLocalError] = useState('');

  if (!show) return null;

  const update = <K extends keyof ContractModificationForm>(
    field: K,
    value: ContractModificationForm[K],
  ) => {
    setLocalError('');
    onFormChange((prev) => ({ ...prev, [field]: value }));
  };

  const handleLeaseChange = (leaseId: string) => {
    const lease = leases.find((l) => l.id === leaseId);
    onFormChange((prev) => ({
      ...prev,
      lease_id: leaseId,
      old_monthly_payment: lease ? Number(lease.payment_amount) : prev.old_monthly_payment,
      old_lease_term: lease ? Number(lease.lease_term_months) : prev.old_lease_term,
      old_discount_rate: lease ? Number(lease.discount_rate ?? lease.incremental_borrowing_rate) : prev.old_discount_rate,
      new_monthly_payment: lease ? Number(lease.payment_amount) : prev.new_monthly_payment,
      new_lease_term: lease ? Number(lease.lease_term_months) : prev.new_lease_term,
      new_discount_rate: lease ? Number(lease.discount_rate ?? lease.incremental_borrowing_rate) : prev.new_discount_rate,
    }));
  };

  const handleBeforeSubmit = (e: React.FormEvent) => {
    if (!form.lease_id) {
      e.preventDefault();
      setLocalError('Please select a lease.');
      return;
    }
    if (!form.modification_date) {
      e.preventDefault();
      setLocalError('Please select a modification date.');
      return;
    }
    onSubmit(e);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {editing ? 'Edit Modification' : 'New Modification'}
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
                value={form.lease_id}
                onChange={(e) => handleLeaseChange(e.target.value)}
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
                value={form.modification_date}
                onChange={(e) => update('modification_date', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Type</label>
            <select
              value={form.modification_type}
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
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reason</label>
            <textarea
              value={form.reason}
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
                value={form.new_monthly_payment}
                onChange={(e) => update('new_monthly_payment', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">New Term (months)</label>
              <input
                type="number"
                min="0"
                value={form.new_lease_term}
                onChange={(e) => update('new_lease_term', Number(e.target.value))}
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
                value={form.new_discount_rate}
                onChange={(e) => update('new_discount_rate', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="cm_separate_contract"
              checked={form.separate_contract}
              onChange={(e) => update('separate_contract', e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="cm_separate_contract" className="text-sm text-slate-700">
              Grants an additional right of use priced at its standalone price
            </label>
          </div>

          {form.separate_contract && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              This modification grants a separate right of use and should be accounted for as a new lease. No remeasurement is performed.
            </div>
          )}

          {!form.separate_contract && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Reassess Classification</label>
                <select
                  value={form.new_classification}
                  onChange={(e) => update('new_classification', e.target.value)}
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
                  value={form.new_fair_value ?? ''}
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
                  value={form.new_economic_life_months ?? ''}
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
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Optional notes"
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
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : editing ? 'Update Modification' : 'Create Modification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { TransactionFormData } from './types';

interface AddTransactionModalProps {
  leases: Lease[];
  formData: TransactionFormData;
  setFormData: React.Dispatch<React.SetStateAction<TransactionFormData>>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const TYPE_OPTIONS = [
  'payment',
  'interest',
  'amortization',
  'initial_recognition',
  'lease_modification',
  'lease_cancellation',
  'impairment',
  'derecognition',
];

export function AddTransactionModal({
  leases,
  formData,
  setFormData,
  submitting,
  onClose,
  onSubmit,
}: AddTransactionModalProps) {
  const [localError, setLocalError] = useState('');

  const update = (field: keyof TransactionFormData, value: string) => {
    setLocalError('');
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleLeaseChange = (leaseId: string) => {
    update('lease_id', leaseId);
    const lease = leases.find((l) => l.id === leaseId);
    if (lease && !formData.transaction_date) {
      update('transaction_date', lease.lease_start_date?.split('T')[0] ?? formData.transaction_date);
    }
  };

  const handleBeforeSubmit = (e: React.FormEvent) => {
    if (!formData.lease_id) {
      e.preventDefault();
      setLocalError('Please select a lease.');
      return;
    }
    onSubmit(e);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Add Transaction</h2>
          <button onClick={onClose} aria-label="Close add transaction dialog" className="text-slate-500 hover:text-slate-700 transition">
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
              value={formData.lease_id}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={formData.transaction_date}
                onChange={(e) => update('transaction_date', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={formData.transaction_type}
                onChange={(e) => update('transaction_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Account Debited</label>
              <input
                type="text"
                value={formData.account_debited}
                onChange={(e) => update('account_debited', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g. Lease Liability"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Account Credited</label>
              <input
                type="text"
                value={formData.account_credited}
                onChange={(e) => update('account_credited', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g. Cash"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Debit Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.debit_amount}
                onChange={(e) => update('debit_amount', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Credit Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.credit_amount}
                onChange={(e) => update('credit_amount', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => update('description', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reference Number</label>
            <input
              type="text"
              value={formData.reference_number}
              onChange={(e) => update('reference_number', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Optional reference"
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
              {submitting ? 'Saving…' : 'Save Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { X } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { ImpairmentFormData } from '../../hooks/useImpairmentActions';

interface ImpairmentFormModalProps {
  leases: Lease[];
  impForm: ImpairmentFormData;
  setImpForm: React.Dispatch<React.SetStateAction<ImpairmentFormData>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent, form: ImpairmentFormData) => void;
}

export function ImpairmentFormModal({ leases, impForm, setImpForm, onClose, onSubmit }: ImpairmentFormModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-orange-600 text-white flex items-center justify-between">
          <h3 className="text-lg font-bold">Record ROU Impairment</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={(e) => onSubmit(e, impForm)} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Lease</label>
            <select
              required
              value={impForm.lease_id}
              onChange={(e) => setImpForm(f => ({ ...f, lease_id: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Select a lease…</option>
              {leases.filter(l => l.status === 'active' && l.accounting_treatment !== 'short_term_exemption').map(l => (
                <option key={l.id} value={l.id}>{l.lease_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Impairment Date</label>
            <input
              type="date"
              required
              value={impForm.impairment_date}
              onChange={(e) => setImpForm(f => ({ ...f, impairment_date: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Impairment Amount</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={impForm.impairment_amount || ''}
              onChange={(e) => setImpForm(f => ({ ...f, impairment_amount: Number(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Reason</label>
            <textarea
              value={impForm.reason}
              onChange={(e) => setImpForm(f => ({ ...f, reason: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="Describe the reason for the impairment…"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
            >
              Create Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

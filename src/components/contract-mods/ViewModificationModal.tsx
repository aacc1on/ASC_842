import { X } from 'lucide-react';
import type { Lease } from '../../types/lease';
import type { ContractModificationRow } from './contractModHelpers';

interface ViewModificationModalProps {
  show: boolean;
  modification: ContractModificationRow | null;
  leases: Lease[];
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{label}</p>
      <p className="text-sm text-slate-900">{value ?? '—'}</p>
    </div>
  );
}

export function ViewModificationModal({
  show,
  modification,
  leases,
  onClose,
}: ViewModificationModalProps) {
  if (!show || !modification) return null;

  const lease = leases.find((l) => l.id === modification.lease_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Modification Details</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lease" value={lease?.lease_name ?? '(deleted lease)'} />
            <Field label="Date" value={modification.modification_date?.split('T')[0]} />
            <Field
              label="Type"
              value={<span className="capitalize">{modification.modification_type?.replace(/_/g, ' ')}</span>}
            />
            <Field label="Status" value={<span className="capitalize">{modification.status}</span>} />
          </div>

          <Field label="Reason" value={modification.reason} />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Old Monthly Payment"
              value={`$${Number(modification.old_monthly_payment).toLocaleString()}`}
            />
            <Field
              label="New Monthly Payment"
              value={`$${Number(modification.new_monthly_payment).toLocaleString()}`}
            />
            <Field label="Old Term" value={`${modification.old_lease_term} months`} />
            <Field label="New Term" value={`${modification.new_lease_term} months`} />
          </div>

          {modification.notes && <Field label="Notes" value={modification.notes} />}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import { X } from 'lucide-react';
import type { JournalEntry } from '../../types/lease';
import type { CancellationRow } from './types';

interface CancellationDetailModalProps {
  cancellation: CancellationRow | null;
  journalEntries: JournalEntry[];
  journalLoading: boolean;
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

export function CancellationDetailModal({
  cancellation,
  journalEntries,
  journalLoading,
  onClose,
}: CancellationDetailModalProps) {
  if (!cancellation) return null;

  const gainLoss = Number(cancellation.gain_loss_amount ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Cancellation Details</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-500 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lease" value={cancellation.lease_name ?? '(deleted lease)'} />
            <Field label="Date" value={cancellation.cancellation_date?.split('T')[0]} />
            <Field label="Status" value={<span className="capitalize">{cancellation.status}</span>} />
            <Field label="Early Termination" value={cancellation.early_termination ? 'Yes' : 'No'} />
          </div>

          <Field label="Reason" value={cancellation.cancellation_reason} />

          <div className="grid grid-cols-3 gap-4">
            <Field
              label="Termination Penalty"
              value={`$${Number(cancellation.termination_penalty).toLocaleString()}`}
            />
            <Field
              label="Final Payment"
              value={`$${Number(cancellation.final_payment_amount).toLocaleString()}`}
            />
            <Field
              label="Gain / (Loss)"
              value={
                <span className={gainLoss >= 0 ? 'text-green-700' : 'text-red-700'}>
                  {gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString()}
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Remaining ROU Asset"
              value={`$${Number(cancellation.remaining_rou_asset).toLocaleString()}`}
            />
            <Field
              label="Remaining Liability"
              value={`$${Number(cancellation.remaining_lease_liability).toLocaleString()}`}
            />
          </div>

          {cancellation.settlement_details && (
            <Field label="Settlement Details" value={cancellation.settlement_details} />
          )}

          <Field
            label="Derecognition Posted"
            value={cancellation.derecognition_posted ? 'Yes' : 'No'}
          />

          {/* Journal entries */}
          <div className="pt-2 border-t border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Journal Entries</h3>
            {journalLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : journalEntries.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">No journal entries found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3 font-semibold">Date</th>
                      <th className="py-2 px-3 font-semibold">Account</th>
                      <th className="py-2 px-3 font-semibold text-right">Debit</th>
                      <th className="py-2 px-3 font-semibold text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalEntries.map((j) => (
                      <tr key={j.id} className="border-b border-slate-100">
                        <td className="py-2 px-3 text-slate-600">{j.entry_date?.split('T')[0]}</td>
                        <td className="py-2 px-3 text-slate-900">{j.account_name}</td>
                        <td className="py-2 px-3 text-right text-slate-600">
                          {j.debit_amount ? `$${Number(j.debit_amount).toLocaleString()}` : ''}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-600">
                          {j.credit_amount ? `$${Number(j.credit_amount).toLocaleString()}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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

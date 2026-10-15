import { useState, useEffect, useRef } from 'react';
import {
  Info, Upload, X, ToggleLeft, ToggleRight,
} from 'lucide-react';
import {
  POLICY_TYPES, isRiskFreeRateEligible,
  type PolicyType, type EntityType, type PolicyElection,
} from '../../utils/policyElections';
import { POLICY_LABELS, POLICY_TOOLTIPS, STATUS_STYLES } from './policyDisplay';

interface EditElectionModalProps {
  assetTypeName: string;
  assetTypeId: string;
  elections: PolicyElection[];
  entityType: EntityType | null;
  onSave: (params: {
    fixedAssetTypeId: string;
    policyType: PolicyType;
    electionValue: boolean;
    effectiveFrom: string;
    notes?: string;
    changeReason?: string;
    supportingDocumentId?: string | null;
  }) => Promise<{ success: boolean; id?: string; status?: string }>;
  onSubmit: (id: string) => Promise<boolean>;
  hookError?: string | null;
  onClose: () => void;
}

export function EditElectionModal({
  assetTypeName, assetTypeId, elections, entityType,
  onSave, onSubmit, hookError, onClose,
}: EditElectionModalProps) {
  const [policyType, setPolicyType] = useState<PolicyType>('SHORT_TERM_LEASE');
  const [electionValue, setElectionValue] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [supportingDocumentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const rfrEligible = isRiskFreeRateEligible(entityType);
  const policyElections = elections.filter((e) => e.policy_type === policyType);
  const latestElection = policyElections[0] ?? null;
  const hasApproved = policyElections.some((e) => e.status === 'approved');
  const requiresChangeReason = hasApproved;

  // Read through a ref so the pre-fill runs only when the policy type switches, not when elections reload.
  const latestElectionRef = useRef(latestElection);
  useEffect(() => { latestElectionRef.current = latestElection; });

  // Pre-fill form from the latest election when switching policy type
  useEffect(() => {
    const latest = latestElectionRef.current;
    if (latest) {
      setElectionValue(latest.election_value);
      setEffectiveFrom(latest.effective_from);
      setNotes(latest.notes ?? '');
    } else {
      setElectionValue(true);
      setEffectiveFrom(new Date().toISOString().split('T')[0]);
      setNotes('');
    }
    setChangeReason('');
    setSaved(null);
    setError(null);
  }, [policyType]);

  const handleSave = async () => {
    if (requiresChangeReason && !changeReason.trim()) {
      setError('Change reason is required when modifying an approved policy.');
      return;
    }
    if (policyType === 'RISK_FREE_RATE' && electionValue && !rfrEligible) {
      setError('Risk-free rate election is not available for this entity type.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave({
      fixedAssetTypeId: assetTypeId,
      policyType,
      electionValue,
      effectiveFrom,
      notes: notes.trim() || undefined,
      changeReason: changeReason.trim() || undefined,
      supportingDocumentId,
    });
    setSaving(false);
    if (result.success) {
      setError(null);
      setSaved(result.status === 'approved' ? 'Saved. The election is active now.' : 'Saved and sent for approval.');
    } else {
      setError('Failed to save. Check your subscription status and try again.');
    }
  };

  const handleSubmit = async () => {
    if (!latestElection) return;
    setActionId(latestElection.id);
    setError(null);
    const ok = await onSubmit(latestElection.id);
    setActionId(null);
    if (!ok) setError(hookError ?? 'Failed to resubmit.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-blue-900 text-white flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Policy Election</div>
            <h3 className="text-lg font-bold mt-0.5">{assetTypeName}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Policy type selector */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Policy Type</label>
            <div className="grid grid-cols-1 gap-2">
              {POLICY_TYPES.map((pt) => {
                const disabled = pt === 'RISK_FREE_RATE' && !rfrEligible;
                return (
                  <button
                    key={pt}
                    onClick={() => !disabled && setPolicyType(pt)}
                    disabled={disabled}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm font-semibold transition ${
                      policyType === pt
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : disabled
                          ? 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {POLICY_LABELS[pt]}
                      <Info className="w-3 h-3 text-slate-500" />
                    </span>
                    <span className="block text-xs font-normal text-slate-500 mt-0.5">{POLICY_TOOLTIPS[pt]}</span>
                    {disabled && <span className="block text-xs text-slate-500 mt-0.5">Not eligible for this entity type.</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Election toggle */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Election</label>
            <button
              onClick={() => setElectionValue(!electionValue)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-700"
            >
              {electionValue ? (
                <ToggleRight className="w-8 h-8 text-blue-600" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-300" />
              )}
              {electionValue ? 'Elected / Combined' : 'Not Elected / Separated'}
            </button>
          </div>

          {/* Effective date */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Effective From</label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Change reason */}
          {requiresChangeReason && (
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">
                Change Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                rows={2}
                placeholder="Required when changing an approved policy."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Supporting document */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block flex items-center gap-1">
              Supporting Document (optional)
              <Upload className="w-3 h-3 text-slate-500" />
            </label>
            <p className="text-xs text-slate-500">Upload via the Documents page and link here.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          {saved && !error && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">{saved}</div>
          )}

          {/* Current election status + workflow actions */}
          {latestElection && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">Current version: v{latestElection.policy_version}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_STYLES[latestElection.status]?.className}`}>
                  {STATUS_STYLES[latestElection.status]?.label}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {latestElection.election_value ? 'Elected' : 'Not Elected'} · Effective {latestElection.effective_from}
                {latestElection.effective_to ? ` → ${latestElection.effective_to}` : ''}
              </div>

              {latestElection.status === 'pending_approval' && (
                <p className="text-xs text-amber-700 font-semibold pt-1">
                  Awaiting approval. An approver can review it in Settings &gt; Approval.
                </p>
              )}
              {latestElection.status === 'approved' && latestElection.self_approved && (
                <p className="text-xs text-emerald-700 font-semibold pt-1">
                  Active. Approved by the preparer{latestElection.approved_at ? ` on ${latestElection.approved_at.split('T')[0]}` : ''}.
                </p>
              )}
              {latestElection.status === 'draft' && (
                <div className="space-y-2 pt-1">
                  {latestElection.rejection_comment && (
                    <p className="text-xs text-red-700">Returned by the approver: {latestElection.rejection_comment}</p>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={actionId === latestElection.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {actionId === latestElection.id ? 'Submitting...' : 'Resubmit'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

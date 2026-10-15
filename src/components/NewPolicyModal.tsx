import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Plus, X } from 'lucide-react';
import {
  POLICY_TYPES, isRiskFreeRateEligible,
  type AssetTypeInfo, type EntityType, type PolicyType,
} from '../utils/policyElections';
import {
  findDuplicateAssetClass,
  type CreateAssetClassResult, type NewAssetClassParams,
} from '../hooks/usePolicyElections';

type Choice = 'skip' | 'elect' | 'not_elect';

interface NewPolicyModalProps {
  companyName: string;
  assetTypes: AssetTypeInfo[];
  entityType: EntityType | null;
  policyLabels: Record<PolicyType, string>;
  policyTooltips: Record<PolicyType, string>;
  onCreate: (params: NewAssetClassParams) => Promise<CreateAssetClassResult>;
  onClose: () => void;
  onCreated: (message: string) => void;
}

const CHOICE_OPTIONS: { value: Choice; label: string }[] = [
  { value: 'elect', label: 'Elect' },
  { value: 'not_elect', label: 'Do not elect' },
  { value: 'skip', label: 'Decide later' },
];

export function NewPolicyModal({
  companyName, assetTypes, entityType, policyLabels, policyTooltips, onCreate, onClose, onCreated,
}: NewPolicyModalProps) {
  const rfrEligible = isRiskFreeRateEligible(entityType);
  const [typeName, setTypeName] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [choices, setChoices] = useState<Record<PolicyType, Choice>>({
    SHORT_TERM_LEASE: 'elect',
    COMBINE_LEASE_NONLEASE: 'elect',
    RISK_FREE_RATE: rfrEligible ? 'elect' : 'skip',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const duplicate = useMemo(
    () => (typeName.trim() ? findDuplicateAssetClass(assetTypes, typeName) : undefined),
    [assetTypes, typeName]
  );
  const selectedPolicies = POLICY_TYPES
    .filter((pt) => choices[pt] !== 'skip' && (pt !== 'RISK_FREE_RATE' || rfrEligible))
    .map((pt) => ({ policyType: pt, electionValue: choices[pt] === 'elect' }));

  const nameMissing = touched && !typeName.trim();
  const canSave = !!typeName.trim() && !duplicate && !!effectiveFrom && selectedPolicies.length > 0 && !saving;

  const handleSave = async () => {
    setTouched(true);
    if (!typeName.trim()) return setError('Enter a name for the asset class.');
    if (duplicate) return setError(`Asset class "${duplicate.type_name}" already exists. Use Configure on its row instead.`);
    if (selectedPolicies.length === 0) return setError('Choose at least one policy to elect or not elect.');
    setSaving(true);
    setError(null);
    const result = await onCreate({ typeName, typeCode, effectiveFrom, notes, policies: selectedPolicies });
    setSaving(false);
    if (!result.ok) {
      setError(result.duplicate ? `${result.message} Use Configure on its row instead.` : result.message);
      return;
    }
    onCreated(
      result.policiesSaved
        ? `Asset class "${typeName.trim()}" created with ${selectedPolicies.length} ${selectedPolicies.length === 1 ? 'policy' : 'policies'}.`
        : `Asset class "${typeName.trim()}" was created, but its policies could not be saved. Use Configure to add them.`
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="new-policy-title" className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-blue-900 text-white flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-blue-200 uppercase tracking-wider">New Policy · {companyName}</div>
            <h3 id="new-policy-title" className="text-lg font-bold mt-0.5">Create asset class and elections</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="new-asset-class-name" className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">
                Asset Class Name <span className="text-red-500">*</span>
              </label>
              <input
                id="new-asset-class-name"
                autoFocus
                value={typeName}
                onChange={(e) => { setTypeName(e.target.value); setError(null); }}
                onBlur={() => setTouched(true)}
                placeholder="e.g. Office Equipment"
                className={`w-full px-3 py-2 rounded-lg border text-sm text-slate-900 focus:outline-none focus:ring-2 transition ${
                  duplicate || nameMissing ? 'border-red-300 focus:ring-red-400 bg-red-50/40' : 'border-slate-200 focus:ring-blue-500'
                }`}
              />
            </div>
            <div>
              <label htmlFor="new-asset-class-code" className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Code</label>
              <input
                id="new-asset-class-code"
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          {duplicate && (
            <div role="alert" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Asset class <strong>{duplicate.type_name}</strong> already exists{duplicate.is_active ? '' : ' (inactive)'}.
                Each asset class can only be created once. Use Configure on its row to change its policies.
              </span>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Policies</div>
            <div className="space-y-2">
              {POLICY_TYPES.map((pt) => {
                const disabled = pt === 'RISK_FREE_RATE' && !rfrEligible;
                return (
                  <div key={pt} className={`border rounded-xl px-3 py-3 transition ${disabled ? 'border-slate-200 bg-slate-50' : 'border-slate-200 hover:border-blue-200'}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold flex items-center gap-1 ${disabled ? 'text-slate-400' : 'text-slate-800'}`}>
                          {policyLabels[pt]}
                          <span title={policyTooltips[pt]}><Info className="w-3 h-3 text-slate-500" /></span>
                        </div>
                        {disabled && <div className="text-xs text-slate-500 mt-0.5">Not eligible for this entity type.</div>}
                      </div>
                      {!disabled && (
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label={policyLabels[pt]}>
                          {CHOICE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={choices[pt] === opt.value}
                              onClick={() => { setChoices((prev) => ({ ...prev, [pt]: opt.value })); setError(null); }}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                                choices[pt] === opt.value
                                  ? opt.value === 'skip' ? 'bg-white text-slate-700 shadow-sm' : 'bg-blue-600 text-white shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-policy-effective" className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Effective From</label>
              <input
                id="new-policy-effective"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="new-policy-notes" className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Notes</label>
              <input
                id="new-policy-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {selectedPolicies.length} {selectedPolicies.length === 1 ? 'policy' : 'policies'} selected
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import {
  ShieldCheck, CheckCircle2, AlertTriangle, ChevronRight,
  Info, X, History, UserCheck, Plus,
} from 'lucide-react';
import { NewPolicyModal } from './NewPolicyModal';
import type { UserRole } from '../App';
import { usePolicyElections } from '../hooks/usePolicyElections';
import { SettingsTabs } from './SettingsTabs';
import {
  POLICY_TYPES,
  getPolicyCoverage, isFullyConfigured,
  type PolicyType, type EntityType, type PolicyElection,
} from '../utils/policyElections';

interface AccountingPoliciesPageProps {
  userRole: UserRole;
}
import { POLICY_LABELS, POLICY_TOOLTIPS, ENTITY_LABELS, STATUS_STYLES } from './policies/policyDisplay';
import { CoverageBadge } from './policies/CoverageBadge';
import { EditElectionModal } from './policies/EditElectionModal';

export function AccountingPoliciesPage({ userRole }: AccountingPoliciesPageProps) {
  const hook = usePolicyElections();
  const [editingElection, setEditingElection] = useState<{
    assetTypeId: string;
    assetTypeName: string;
    policyType: PolicyType;
    existing: PolicyElection | null;
  } | null>(null);
  const [historyAsset, setHistoryAsset] = useState<string | null>(null);
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = userRole === 'admin' || userRole === 'manage';

  const coverage = useMemo(() => {
    if (!hook.selectedCompany || hook.assetTypes.length === 0) return [];
    return getPolicyCoverage(
      hook.assetTypes,
      hook.elections,
      new Date().toISOString().split('T')[0],
      hook.selectedCompany.id,
      hook.selectedCompany.entity_type
    );
  }, [hook.selectedCompany, hook.assetTypes, hook.elections]);

  const fullyConfigured = isFullyConfigured(coverage);

  if (hook.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <SettingsTabs isAdmin={userRole === 'admin'} />
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 border border-blue-100 rounded-2xl p-5 flex items-start gap-4">
        <div className="bg-blue-600 text-white p-3 rounded-xl shadow-sm">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">ASC 842 Policy Elections</h2>
          <p className="text-sm text-slate-600 mt-1">
            Record and disclose accounting policy elections by class of underlying asset per FASB ASC 842.
          </p>
          <p className="text-xs text-slate-500 mt-2 italic">
            Elections are recorded and disclosed. They will be applied to lease calculations in a later release.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-slate-500 uppercase">Status</div>
          {fullyConfigured ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" /> Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" /> Incomplete
            </span>
          )}
        </div>
      </div>

      {hook.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {hook.error}
        </div>
      )}

      {/* Company selector + entity type */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Company</label>
            <select
              value={hook.selectedCompanyId ?? ''}
              onChange={(e) => hook.setSelectedCompanyId(e.target.value || null)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select company...</option>
              {hook.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          {canEdit && hook.selectedCompany && (
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                Entity Type
                <span title="Determines eligibility for the risk-free rate election. Only non-public business entities and not-for-profit entities may elect the risk-free rate.">
                  <Info className="w-3 h-3 text-slate-500" />
                </span>
              </label>
              <select
                value={hook.selectedCompany.entity_type ?? ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  hook.setCompanyEntityType(hook.selectedCompany!.id, val as EntityType | null);
                }}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Not set</option>
                <option value="public_business_entity">Public Business Entity</option>
                <option value="non_public_business_entity">Non-Public Business Entity</option>
                <option value="not_for_profit_other">Not-for-Profit / Other</option>
              </select>
            </div>
          )}
          {!canEdit && hook.selectedCompany && (
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Entity Type</label>
              <div className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-slate-50">
                {hook.selectedCompany.entity_type ? ENTITY_LABELS[hook.selectedCompany.entity_type] : 'Not set'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Elections table */}
      {hook.selectedCompany && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Policy Elections by Asset Class</h3>
              <p className="text-xs text-slate-500 mt-0.5">Each election is recorded by class of underlying asset.</p>
            </div>
            {canEdit && (
              <button
                onClick={() => { setNotice(null); setShowNewPolicy(true); }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-semibold shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                New Policy
              </button>
            )}
          </div>
          {notice && (
            <div role="status" className="mx-5 mt-4 flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-800">
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="p-0.5 rounded hover:bg-emerald-100">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase">Asset Class</th>
                  {POLICY_TYPES.map((pt) => (
                    <th key={pt} className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">
                      <span className="inline-flex items-center gap-1" title={POLICY_TOOLTIPS[pt]}>
                        {POLICY_LABELS[pt]}
                        <Info className="w-3 h-3 text-slate-500" />
                      </span>
                    </th>
                  ))}
                  <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">Effective</th>
                  <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">Status</th>
                  <th className="text-center px-3 py-3 text-xs font-bold text-slate-600 uppercase">Ver</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hook.assetTypes.filter((a) => a.is_active).map((asset) => {
                  const assetElections = hook.elections.filter((e) => e.fixed_asset_type_id === asset.id);
                  const latestElection = assetElections[0];
                  return (
                    <tr key={asset.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <button
                          onClick={() => setHistoryAsset(historyAsset === asset.id ? null : asset.id)}
                          className="inline-flex items-center gap-1 hover:text-blue-600"
                        >
                          {asset.type_name}
                          <History className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      </td>
                      {POLICY_TYPES.map((pt) => {
                        const entry = coverage.find((c) => c.assetTypeId === asset.id && c.policyType === pt);
                        return (
                          <td key={pt} className="text-center px-3 py-3">
                            <CoverageBadge result={entry?.result ?? 'not_configured'} value={entry?.electionValue ?? null} />
                          </td>
                        );
                      })}
                      <td className="text-center px-3 py-3 text-xs text-slate-600">
                        {latestElection ? latestElection.effective_from : '—'}
                      </td>
                      <td className="text-center px-3 py-3">
                        {latestElection ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_STYLES[latestElection.status]?.className}`}>
                              {STATUS_STYLES[latestElection.status]?.label}
                            </span>
                            {latestElection.self_approved && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold" title="Approved by the preparer">
                                <UserCheck className="w-3 h-3" />
                                Self
                              </span>
                            )}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="text-center px-3 py-3 text-xs text-slate-500">
                        {latestElection ? latestElection.policy_version : '—'}
                      </td>
                      <td className="text-right px-4 py-3">
                        {canEdit && (
                          <button
                            onClick={() => setEditingElection({
                              assetTypeId: asset.id,
                              assetTypeName: asset.type_name,
                              policyType: 'SHORT_TERM_LEASE',
                              existing: latestElection ?? null,
                            })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition"
                          >
                            Configure
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Version history panel */}
          {historyAsset && (
            <div className="border-t border-slate-200 bg-slate-50/50">
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-700">
                  Version History — {hook.assetTypes.find((a) => a.id === historyAsset)?.type_name}
                </h4>
                <button onClick={() => setHistoryAsset(null)} className="p-1 rounded hover:bg-slate-200">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="px-5 py-3 space-y-2">
                {hook.elections.filter((e) => e.fixed_asset_type_id === historyAsset).length === 0 && (
                  <p className="text-sm text-slate-500">No elections recorded for this asset class.</p>
                )}
                {hook.elections
                  .filter((e) => e.fixed_asset_type_id === historyAsset)
                  .sort((a, b) => b.policy_version - a.policy_version)
                  .map((e) => (
                    <div key={e.id} className="flex items-center gap-3 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
                      <span className="text-xs font-mono text-slate-500">v{e.policy_version}</span>
                      <span className="font-semibold text-slate-700">{POLICY_LABELS[e.policy_type]}</span>
                      <span className="text-slate-500">{e.election_value ? 'Elected' : 'Not Elected'}</span>
                      <span className="text-xs text-slate-500">{e.effective_from}{e.effective_to ? ` → ${e.effective_to}` : ''}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_STYLES[e.status]?.className}`}>
                        {STATUS_STYLES[e.status]?.label}
                      </span>
                      {e.self_approved && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold" title="Approved by the preparer">
                          <UserCheck className="w-3 h-3" />
                          Self
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showNewPolicy && hook.selectedCompany && (
        <NewPolicyModal
          companyName={hook.selectedCompany.company_name}
          assetTypes={hook.assetTypes}
          entityType={hook.selectedCompany.entity_type}
          policyLabels={POLICY_LABELS}
          policyTooltips={POLICY_TOOLTIPS}
          onCreate={hook.createAssetClassWithPolicies}
          onClose={() => setShowNewPolicy(false)}
          onCreated={(message) => { setShowNewPolicy(false); setNotice(message); }}
        />
      )}

      {/* Edit modal */}
      {editingElection && (
        <EditElectionModal
          assetTypeName={editingElection.assetTypeName}
          assetTypeId={editingElection.assetTypeId}
          elections={hook.elections.filter((e) => e.fixed_asset_type_id === editingElection.assetTypeId)}
          entityType={hook.selectedCompany?.entity_type ?? null}
          hookError={hook.error}
          onSave={hook.saveElection}
          onSubmit={hook.submitForApproval}
          onClose={() => setEditingElection(null)}
        />
      )}
    </div>
  );
}

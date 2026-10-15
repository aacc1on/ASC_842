import { useState } from 'react';
import { Stamp, Info, Check, X, Users, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import type { UserRole } from '../App';
import { useApprovalSettings } from '../hooks/useApprovalSettings';
import { SettingsTabs } from './SettingsTabs';
import {
  APPROVAL_ITEM_LABEL,
  APPROVAL_ITEM_TYPES,
  type ApprovalItemType,
  type ApproverRole,
  type PendingApproval,
} from '../utils/approvals';

interface ApprovalSettingsTabProps {
  userRole: UserRole;
  onPendingChange?: () => void;
}

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-blue-600' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

const money = (n: number | null) =>
  n === null ? '' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function ApprovalSettingsTab({ userRole, onPendingChange }: ApprovalSettingsTabProps) {
  const s = useApprovalSettings(onPendingChange);
  const [confirmOff, setConfirmOff] = useState(false);
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [comment, setComment] = useState('');

  const isAdmin = userRole === 'admin';
  const canEdit = isAdmin && !s.saving;

  if (s.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const settings = s.settings;

  const handleEnabledChange = (value: boolean) => {
    if (!value && s.pending.length > 0) {
      setConfirmOff(true);
      return;
    }
    s.updateSettings({ enabled: value });
  };

  const toggleType = (key: ApprovalItemType) => {
    if (!settings) return;
    const next = settings.item_types.includes(key)
      ? settings.item_types.filter(t => t !== key)
      : [...settings.item_types, key];
    s.updateSettings({ item_types: next });
  };

  const submitReject = async () => {
    if (!rejecting || !comment.trim()) return;
    const ok = await s.reject(rejecting.item_type, rejecting.item_id, comment);
    if (ok) {
      setRejecting(null);
      setComment('');
    }
  };

  const canSeparate = s.userCount >= 2;

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <SettingsTabs pendingCount={s.pending.length} isAdmin={isAdmin} />

      <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 border border-blue-100 rounded-2xl p-5 flex items-start gap-4">
        <div className="bg-blue-600 text-white p-3 rounded-xl shadow-sm">
          <Stamp className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">Approval workflow</h2>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            When the workflow is off, every policy election, modification, cancellation, impairment and month-end close takes
            effect as soon as it is saved, and is recorded as auto-approved in the audit trail. When it is on, the item types
            you choose below are saved as <span className="font-semibold text-orange-700">Pending approval</span> and do not
            affect schedules, journal entries, reports or disclosures until an approver signs off.
          </p>
          {!isAdmin && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Lock className="w-3.5 h-3.5" /> Only administrators can change these settings.
            </p>
          )}
        </div>
      </div>

      {s.error && (
        <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{s.error}</span>
          <button onClick={s.clearMessages} aria-label="Dismiss" className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}
      {s.notice && (
        <div role="status" className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{s.notice}</span>
          <button onClick={s.clearMessages} aria-label="Dismiss" className="text-emerald-600 hover:text-emerald-800"><X className="w-4 h-4" /></button>
        </div>
      )}

      {settings && (
        <section className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-sm">
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <h3 className="font-semibold text-slate-900">Enable approval workflow</h3>
              <p className="text-sm text-slate-500 mt-0.5">
                {settings.enabled ? 'Selected items need sign-off before they take effect.' : 'Off: items take effect immediately when saved.'}
              </p>
            </div>
            <Switch label="Enable approval workflow" checked={settings.enabled} disabled={!canEdit} onChange={handleEnabledChange} />
          </div>

          {settings.enabled && (
            <>
              <div className="p-5">
                <h3 className="font-semibold text-slate-900">Items that need approval</h3>
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {APPROVAL_ITEM_TYPES.map(t => {
                    const checked = settings.item_types.includes(t.key);
                    return (
                      <label
                        key={t.key}
                        className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                          checked ? 'border-blue-200 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'
                        } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={checked}
                          disabled={!canEdit}
                          onChange={() => toggleType(t.key)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">{t.label}</span>
                          <span className="block text-xs text-slate-500">{t.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="p-5">
                <h3 className="font-semibold text-slate-900">Who can approve</h3>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Who can approve">
                  {([['admin', 'Admins'], ['manage', 'Admins and Managers']] as [ApproverRole, string][]).map(([value, label]) => (
                    <label
                      key={value}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        settings.approver_role === value ? 'border-blue-300 bg-blue-50 text-blue-800 font-medium' : 'border-slate-200 text-slate-700'
                      } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    >
                      <input
                        type="radio"
                        name="approver_role"
                        value={value}
                        className="text-blue-600 focus:ring-blue-500"
                        checked={settings.approver_role === value}
                        disabled={!canEdit}
                        onChange={() => s.updateSettings({ approver_role: value })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 p-5">
                <div>
                  <h3 className="font-semibold text-slate-900">Approver must be a different person than the preparer</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Enforces segregation of duties: nobody can approve an item they prepared. When off, a preparer with
                    approval rights can approve their own work and it is recorded as self-approved.
                  </p>
                  {!canSeparate && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <Users className="w-3.5 h-3.5" /> Available once your organization has at least two users.
                    </p>
                  )}
                </div>
                <Switch
                  label="Approver must be a different person than the preparer"
                  checked={settings.require_different_approver}
                  disabled={!canEdit || (!canSeparate && !settings.require_different_approver)}
                  onChange={v => s.updateSettings({ require_different_approver: v })}
                />
              </div>
            </>
          )}
        </section>
      )}

      {(settings?.enabled || s.pending.length > 0) && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Pending approvals</h3>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-700">{s.pending.length} pending</span>
          </div>
          {s.pending.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">Nothing is waiting for approval.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Prepared by</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Amount / summary</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {s.pending.map(p => {
                    const own = p.prepared_by === s.currentUserId;
                    return (
                      <tr key={`${p.item_type}-${p.item_id}`} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3 font-medium text-slate-800">{p.title}</td>
                        <td className="px-5 py-3 text-slate-600">{APPROVAL_ITEM_LABEL[p.item_type]}</td>
                        <td className="px-5 py-3 text-slate-600">{p.prepared_by_name}{own && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{new Date(p.prepared_at).toLocaleDateString()}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {p.amount !== null && <span className="font-medium text-slate-800 mr-2">{money(p.amount)}</span>}
                          {p.summary}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => s.approve(p.item_type, p.item_id)}
                              disabled={s.saving}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => { setRejecting(p); setComment(''); }}
                              disabled={s.saving}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-50 transition"
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {confirmOff && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-off-title">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-start gap-3">
              <Info className="w-6 h-6 text-orange-500 shrink-0" />
              <div>
                <h3 id="confirm-off-title" className="font-bold text-slate-900">Turn off approval workflow?</h3>
                <p className="text-sm text-slate-600 mt-1">
                  {s.pending.length} items are pending. Turn off and approve them automatically?
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setConfirmOff(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={async () => { setConfirmOff(false); await s.turnOffAndApprovePending(); }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Turn off and approve
              </button>
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="reject-title">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 id="reject-title" className="font-bold text-slate-900">Reject "{rejecting.title}"</h3>
            <p className="text-sm text-slate-600 mt-1">The item goes back to the preparer as a draft. Explain what needs to change.</p>
            <label htmlFor="reject-comment" className="block text-xs font-semibold text-slate-600 mt-4 mb-1">Comment (required)</label>
            <textarea
              id="reject-comment"
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRejecting(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={submitReject}
                disabled={!comment.trim() || s.saving}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Lock, User, Mail, Phone, Building2, Briefcase, Clock, Activity } from 'lucide-react';
import type { UserProfile, ActivityLog } from './types';
import { MfaSection } from './MfaSection';

interface ProfileTabProps {
  profile: UserProfile;
  activityLogs: ActivityLog[];
  userEmail: string;
  updateProfile: <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => void;
  onOpenPasswordModal: () => void;
}

const FIELD_CLS =
  'w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ProfileTab({
  profile,
  activityLogs,
  userEmail,
  updateProfile,
  onOpenPasswordModal,
}: ProfileTabProps) {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Personal Information</h2>
        <p className="text-sm text-slate-500 mb-6">Update your personal details and contact information.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Full Name" icon={<User className="w-4 h-4" />}>
            <input
              type="text"
              value={profile.full_name}
              onChange={(e) => updateProfile('full_name', e.target.value)}
              className={FIELD_CLS}
              placeholder="Your full name"
            />
          </Field>
          <Field label="Email" icon={<Mail className="w-4 h-4" />}>
            <input
              type="email"
              value={userEmail || profile.email}
              disabled
              className={`${FIELD_CLS} bg-slate-50 text-slate-500 cursor-not-allowed`}
            />
          </Field>
          <Field label="Phone Number" icon={<Phone className="w-4 h-4" />}>
            <input
              type="tel"
              value={profile.phone_number}
              onChange={(e) => updateProfile('phone_number', e.target.value)}
              className={FIELD_CLS}
              placeholder="(555) 000-0000"
            />
          </Field>
          <Field label="Company" icon={<Building2 className="w-4 h-4" />}>
            <input
              type="text"
              value={profile.company_name}
              onChange={(e) => updateProfile('company_name', e.target.value)}
              className={FIELD_CLS}
              placeholder="Company name"
            />
          </Field>
          <Field label="Job Title" icon={<Briefcase className="w-4 h-4" />}>
            <input
              type="text"
              value={profile.job_title}
              onChange={(e) => updateProfile('job_title', e.target.value)}
              className={FIELD_CLS}
              placeholder="Your role"
            />
          </Field>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-8">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Preferences</h2>
        <p className="text-sm text-slate-500 mb-6">Customize your experience.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Field label="Timezone">
            <select
              value={profile.timezone}
              onChange={(e) => updateProfile('timezone', e.target.value)}
              className={FIELD_CLS}
            >
              {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC'].map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Date Format">
            <select
              value={profile.date_format}
              onChange={(e) => updateProfile('date_format', e.target.value)}
              className={FIELD_CLS}
            >
              {['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <select
              value={profile.currency}
              onChange={(e) => updateProfile('currency', e.target.value)}
              className={FIELD_CLS}
            >
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-6 space-y-3">
          <ToggleRow
            label="Email Notifications"
            checked={profile.email_notifications}
            onChange={(v) => updateProfile('email_notifications', v)}
          />
          <ToggleRow
            label="Lease Expiry Alerts"
            checked={profile.lease_expiry_alerts}
            onChange={(v) => updateProfile('lease_expiry_alerts', v)}
          />
          <ToggleRow
            label="Payment Reminders"
            checked={profile.payment_reminders}
            onChange={(v) => updateProfile('payment_reminders', v)}
          />
          <ToggleRow
            label="Monthly Reports"
            checked={profile.monthly_reports}
            onChange={(v) => updateProfile('monthly_reports', v)}
          />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Security</h2>
            <p className="text-sm text-slate-500">Manage your password and account security.</p>
          </div>
          <button
            onClick={onOpenPasswordModal}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
          >
            <Lock className="w-4 h-4" />
            Change Password
          </button>
        </div>
      </div>

      <MfaSection userRole={profile.role} />

      <div className="border-t border-slate-200 pt-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-slate-700" />
          <h2 className="text-xl font-bold text-slate-900">Recent Activity</h2>
        </div>
        {activityLogs.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No recent activity to show.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {activityLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <Clock className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {log.activity_description}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatDate(log.created_at)} &middot; {log.activity_type}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
        {icon}
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          checked ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}

import { X, AlertTriangle, Crown, Settings, Eye } from 'lucide-react';
import type { UserRole } from '../../App';
import type { RoleChangeModalState } from './types';
import { ROLE_CONFIG } from './types';

interface RoleChangeModalProps {
  modalState: RoleChangeModalState;
  roleChanging: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function RoleIcon({ role, className }: { role: UserRole; className?: string }) {
  const Icon = role === 'admin' ? Crown : role === 'manage' ? Settings : Eye;
  return <Icon className={className} />;
}

export function RoleChangeModal({
  modalState,
  roleChanging,
  onClose,
  onConfirm,
}: RoleChangeModalProps) {
  const { email, full_name, currentRole, newRole } = modalState;
  const isPrivilegeEscalation =
    (newRole === 'admin' && currentRole !== 'admin') ||
    (newRole === 'manage' && currentRole === 'view');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-2 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Confirm Role Change</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-500">User</p>
            <p className="font-bold text-slate-900">{full_name || 'Unnamed user'}</p>
            <p className="text-sm text-slate-600">{email}</p>
          </div>

          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-1.5">Current</p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border border-slate-200 bg-slate-50 text-slate-700">
                <RoleIcon role={currentRole} className="w-4 h-4" />
                {ROLE_CONFIG[currentRole].label}
              </div>
            </div>
            <div className="text-slate-500 text-xl">→</div>
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-1.5">New</p>
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border ${
                  newRole === 'admin'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : newRole === 'manage'
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <RoleIcon role={newRole} className="w-4 h-4" />
                {ROLE_CONFIG[newRole].label}
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-600">{ROLE_CONFIG[newRole].description}</p>

          {isPrivilegeEscalation && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                You are granting elevated privileges. This user will gain additional access across the
                organization.
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={roleChanging}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={roleChanging}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {roleChanging ? 'Updating...' : 'Confirm Change'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

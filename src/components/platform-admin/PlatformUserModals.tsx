import { AlertCircle, Pencil, Trash2, Lock, X } from 'lucide-react';
import type { UserRole } from '../../App';
import { ROLE_CONFIG } from '../user/types';
import type { EditState, PlatformUser } from './platformAdminHelpers';

const FIELD_CLS =
  'w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition';

export function EditUserModal({
  state,
  setState,
  saving,
  error,
  onClose,
  onSave,
}: {
  state: EditState;
  setState: React.Dispatch<React.SetStateAction<EditState | null>>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const { user } = state;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-2 rounded-lg">
              <Pencil className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Edit User</h3>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); onSave(); }}
          className="p-6 space-y-5"
        >
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Full Name</label>
            <input
              type="text"
              value={state.fullName}
              onChange={(e) => setState((s) => s ? { ...s, fullName: e.target.value } : s)}
              className={FIELD_CLS}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              className={`${FIELD_CLS} bg-slate-50 text-slate-500 cursor-not-allowed`}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Organization</label>
            <input
              type="text"
              value={user.org_name || '—'}
              disabled
              className={`${FIELD_CLS} bg-slate-50 text-slate-500 cursor-not-allowed`}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Role</label>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(ROLE_CONFIG) as Array<UserRole>).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setState((s) => s ? { ...s, role } : s)}
                  className={`p-3 rounded-lg border text-center transition ${
                    state.role === role
                      ? 'border-slate-700 bg-slate-100 text-slate-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <p className="font-bold text-sm">{ROLE_CONFIG[role].label}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{ROLE_CONFIG[state.role].description}</p>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Lock className="w-4 h-4" /> Reset Password
              </label>
              <button
                type="button"
                onClick={() => setState((s) => s ? { ...s, showPassword: !s.showPassword, newPassword: '' } : s)}
                className="text-xs text-slate-600 font-semibold hover:underline"
              >
                {state.showPassword ? 'Cancel' : 'Set a new password'}
              </button>
            </div>
            {state.showPassword && (
              <div className="relative">
                <input
                  type="password"
                  value={state.newPassword}
                  onChange={(e) => setState((s) => s ? { ...s, newPassword: e.target.value } : s)}
                  placeholder="New password (at least 12 characters)"
                  className={FIELD_CLS}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteConfirmModal({
  user,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  user: PlatformUser;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-lg">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete User</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-500">User</p>
            <p className="font-bold text-slate-900">{user.full_name || user.email.split('@')[0]}</p>
            <p className="text-sm text-slate-600">{user.email}</p>
            {user.org_name && (
              <p className="text-xs text-slate-500 mt-1">Organization: {user.org_name}</p>
            )}
          </div>

          <p className="text-sm text-slate-600">
            This will permanently delete the user's account and remove their profile. This action cannot be undone.
          </p>

          {error && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={saving}
              className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Deleting...' : 'Delete User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { X, UserPlus, Eye, EyeOff, Mail, Lock, User as UserIcon, AlertCircle } from 'lucide-react';
import type { UserRole } from '../../App';
import type { AddUserForm } from '../../utils/managedUserRoles';
import { ROLE_CONFIG } from './types';

interface AddUserModalProps {
  form: AddUserForm;
  setForm: React.Dispatch<React.SetStateAction<AddUserForm>>;
  addingUser: boolean;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
  error?: string;
}

const FIELD_CLS =
  'w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

export function AddUserModal({
  form,
  setForm,
  addingUser,
  showPassword,
  setShowPassword,
  onClose,
  onSubmit,
  error,
}: AddUserModalProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <UserPlus className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Add New User</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
              <Mail className="w-4 h-4" /> Email
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              className={FIELD_CLS}
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
              <Lock className="w-4 h-4" /> Temporary Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 12 characters"
                className={`${FIELD_CLS} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
              <UserIcon className="w-4 h-4" /> Full Name
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              placeholder="Optional"
              className={FIELD_CLS}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Role</label>
            <div className="space-y-2">
              {(Object.keys(ROLE_CONFIG) as Array<UserRole>).map((role) => (
                <label
                  key={role}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    form.role === role
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role}
                    checked={form.role === role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{ROLE_CONFIG[role].label}</p>
                    <p className="text-xs text-slate-500">{ROLE_CONFIG[role].description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={addingUser}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addingUser}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addingUser ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

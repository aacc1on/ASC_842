import { X, Pencil, Mail, Lock, User as UserIcon, Building2, Briefcase } from 'lucide-react';
import type { UserPermissions, UserRole } from '../../App';
import type { ManagedUser } from './types';
import type { EditUserForm } from '../../utils/managedUserRoles';
import { ROLE_CONFIG } from './types';

interface EditUserModalProps {
  user: ManagedUser;
  form: EditUserForm;
  setForm: React.Dispatch<React.SetStateAction<EditUserForm>>;
  editingUser: boolean;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const FIELD_CLS =
  'w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

const PERMISSION_FIELDS: Array<{ key: keyof UserPermissions; label: string; description: string }> = [
  { key: 'view_leases_transactions', label: 'View Leases & Transactions', description: 'Read access to lease and transaction records.' },
  { key: 'view_reports_documents', label: 'View Reports & Documents', description: 'Read access to reports and uploaded documents.' },
  { key: 'create_edit_leases', label: 'Create & Edit Leases', description: 'Create new leases and modify existing ones.' },
  { key: 'delete_leases', label: 'Delete Leases', description: 'Remove leases from the system.' },
  { key: 'create_transactions', label: 'Create Transactions', description: 'Record lease and accounting transactions.' },
  { key: 'run_month_end', label: 'Run Month-End', description: 'Generate month-end documents and entries.' },
  { key: 'manage_modifications', label: 'Manage Modifications', description: 'Approve and manage contract modifications.' },
  { key: 'upload_documents', label: 'Upload Documents', description: 'Upload files to the documents module.' },
  { key: 'manage_user_roles', label: 'Manage User Roles', description: 'Change other users\' roles.' },
  { key: 'access_user_management', label: 'Access User Management', description: 'Open the User Management tab.' },
];

export function EditUserModal({
  user,
  form,
  setForm,
  editingUser,
  showPassword,
  setShowPassword,
  onClose,
  onSubmit,
}: EditUserModalProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setForm((f) => ({
      ...f,
      permissions: { ...f.permissions, [key]: !f.permissions[key] },
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Pencil className="w-5 h-5 text-blue-600" />
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

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
                <UserIcon className="w-4 h-4" /> Full Name
              </label>
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className={FIELD_CLS}
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
                <Mail className="w-4 h-4" /> Email
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className={`${FIELD_CLS} bg-slate-50 text-slate-500 cursor-not-allowed`}
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
                <Building2 className="w-4 h-4" /> Company
              </label>
              <input
                type="text"
                value={form.company_name}
                onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                className={FIELD_CLS}
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-1.5">
                <Briefcase className="w-4 h-4" /> Job Title
              </label>
              <input
                type="text"
                value={form.job_title}
                onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))}
                className={FIELD_CLS}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Role</label>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(ROLE_CONFIG) as Array<UserRole>).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role }))}
                  className={`p-3 rounded-lg border text-center transition ${
                    form.role === role
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <p className="font-bold text-sm">{ROLE_CONFIG[role].label}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{ROLE_CONFIG[form.role].description}</p>
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-700 mb-3">Permissions</h4>
            <div className="space-y-2">
              {PERMISSION_FIELDS.map(({ key, label, description }) => (
                <label
                  key={key}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition"
                >
                  <div className="flex-1 pr-3">
                    <p className="text-sm font-medium text-slate-800">{label}</p>
                    <p className="text-xs text-slate-500">{description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.permissions[key]}
                    onClick={() => togglePermission(key)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition flex-shrink-0 ${
                      form.permissions[key] ? 'bg-blue-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        form.permissions[key] ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Lock className="w-4 h-4" /> Reset Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                {showPassword ? 'Cancel password reset' : 'Set a new password'}
              </button>
            </div>
            {showPassword && (
              <div className="relative">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="New password (at least 8 characters)"
                  className={FIELD_CLS}
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={editingUser}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editingUser}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingUser ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

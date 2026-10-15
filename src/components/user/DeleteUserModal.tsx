import { X, AlertTriangle, Trash2 } from 'lucide-react';
import type { ManagedUser } from './types';
import { ROLE_CONFIG } from './types';

interface DeleteUserModalProps {
  user: ManagedUser;
  deletingUser: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteUserModal({
  user,
  deletingUser,
  onClose,
  onConfirm,
}: DeleteUserModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete User</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-600">
            Are you sure you want to delete this user? This will remove their profile and revoke
            access. This action cannot be undone.
          </p>

          <div className="bg-slate-50 rounded-lg p-4 space-y-1">
            <p className="font-bold text-slate-900">{user.full_name || 'Unnamed user'}</p>
            <p className="text-sm text-slate-600">{user.email}</p>
            <p className="text-xs text-slate-500 mt-1">
              Role: {ROLE_CONFIG[user.role].label}
              {user.company_name ? ` · ${user.company_name}` : ''}
            </p>
          </div>

          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              The user's auth account will need to be removed separately from the Supabase dashboard
              if full removal is required.
            </span>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deletingUser}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deletingUser}
              className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {deletingUser ? 'Deleting...' : 'Delete User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

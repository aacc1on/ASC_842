import { Search, UserPlus, Pencil, Trash2, Users as UsersIcon, Info, AlertTriangle } from 'lucide-react';
import type { UserRole, UserPermissions } from '../../App';
import type { UserProfile, ManagedUser, RoleChangeModalState } from './types';
import { userLimitMessage, type PlanKey } from '../../utils/planFeatures';
import type { UserCapacity } from '../../hooks/useUserCapacity';
import { ROLE_CONFIG } from './types';
import { Pagination } from '../Pagination';
import { usePagination } from '../../hooks/usePagination';

interface ManagementTabProps {
  profile: UserProfile;
  managedUsers: ManagedUser[];
  filteredManagedUsers: ManagedUser[];
  managementLoading: boolean;
  managementSearch: string;
  setManagementSearch: (v: string) => void;
  onAddUserClick: () => void;
  onEditUserClick: (user: ManagedUser) => void;
  onDeleteUserClick: (user: ManagedUser) => void;
  onRoleSelect: (state: RoleChangeModalState) => void;
  planKey: PlanKey;
  capacity?: UserCapacity | null;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
  view_leases_transactions: 'View Leases',
  view_reports_documents: 'View Reports',
  create_edit_leases: 'Edit Leases',
  delete_leases: 'Delete Leases',
  create_transactions: 'Create Transactions',
  run_month_end: 'Run Month-End',
  manage_modifications: 'Manage Modifications',
  upload_documents: 'Upload Documents',
  manage_user_roles: 'Manage Roles',
  access_user_management: 'User Mgmt',
};

export function ManagementTab({
  profile,
  managedUsers,
  filteredManagedUsers,
  managementLoading,
  managementSearch,
  setManagementSearch,
  onAddUserClick,
  onEditUserClick,
  onDeleteUserClick,
  onRoleSelect,
  planKey,
  capacity = null,
}: ManagementTabProps) {
  const { pageItems, paginationProps } = usePagination(filteredManagedUsers, 25);
  const atLimit = capacity !== null && capacity.used >= capacity.max;

  return (
    <div className="p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">User Management</h2>
          <p className="text-sm text-slate-500 mt-1">
            Manage users in your organization. {managedUsers.length} total user{managedUsers.length === 1 ? '' : 's'}.
          </p>
          {capacity && (
            <p className={`text-sm font-semibold mt-1 ${capacity.over ? 'text-red-700' : atLimit ? 'text-amber-700' : 'text-slate-700'}`}>
              {capacity.used} of {capacity.max} user{capacity.max === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <button
            onClick={onAddUserClick}
            disabled={atLimit}
            title={atLimit && capacity ? userLimitMessage(capacity.max) : undefined}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-sm disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
          {atLimit && capacity && !capacity.over && (
            <p className="text-xs text-amber-700 max-w-xs sm:text-right">{userLimitMessage(capacity.max)}</p>
          )}
        </div>
      </div>

      {capacity?.over && (
        <div role="alert" className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 font-medium">
            Your organization has {capacity.used} users but your plan allows up to {capacity.max}. Existing users keep their access, but no new users can be added until you remove {capacity.used - capacity.max === 1 ? 'a user' : `${capacity.used - capacity.max} users`} or contact us to add more.
          </p>
        </div>
      )}

      <div className="relative mb-6">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
        <input
          type="text"
          placeholder="Search by name, email, or company..."
          value={managementSearch}
          onChange={(e) => setManagementSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      {planKey === 'trial' && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800 font-medium">
            Multiple users are included in your free trial. After the trial, Enterprise is required to keep adding users.
          </p>
        </div>
      )}

      {managementLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filteredManagedUsers.length === 0 ? (
        <div className="text-center py-16">
          <UsersIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No users found</p>
          <p className="text-sm text-slate-500 mt-1">
            {managementSearch ? 'Try adjusting your search.' : 'Add a user to get started.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-bold">User</th>
                <th className="text-left px-4 py-3 font-bold">Company / Title</th>
                <th className="text-left px-4 py-3 font-bold">Role</th>
                <th className="text-left px-4 py-3 font-bold">Created</th>
                <th className="text-right px-4 py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageItems.map((user) => {
                const isSelf = user.user_id === profile.user_id;
                return (
                  <tr key={user.user_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {user.full_name || (user.email ? user.email.split('@')[0] : 'No name set')}
                      </div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{user.company_name || '—'}</div>
                      <div className="text-xs text-slate-500">{user.job_title || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border bg-slate-100 text-slate-500 border-slate-200">
                          You
                        </span>
                      ) : (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            onRoleSelect({
                              user_id: user.user_id,
                              email: user.email,
                              full_name: user.full_name,
                              currentRole: user.role,
                              newRole: e.target.value as UserRole,
                            })
                          }
                          className="text-xs font-bold border border-slate-200 rounded-md px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                        >
                          <option value="admin">{ROLE_CONFIG.admin.label}</option>
                          <option value="manage">{ROLE_CONFIG.manage.label}</option>
                          <option value="view">{ROLE_CONFIG.view.label}</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onEditUserClick(user)}
                          className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Edit user"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteUserClick(user)}
                          disabled={isSelf}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isSelf ? 'You cannot delete your own account' : 'Delete user'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4">
            <Pagination {...paginationProps} />
          </div>
        </div>
      )}

      {filteredManagedUsers.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="font-bold text-slate-600">Permission summary:</span>
          {(Object.keys(PERMISSION_LABELS) as Array<keyof UserPermissions>).map((key) => {
            const enabled = filteredManagedUsers.filter((u) => u.permissions?.[key]).length;
            return (
              <span key={key} className="inline-flex items-center gap-1">
                {PERMISSION_LABELS[key]}: <strong className="text-slate-700">{enabled}</strong>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Search, Users, Building2, Mail, Shield, AlertCircle, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../App';
import { Pagination } from './Pagination';
import { DataHealthPanel } from './LedgerHealthPanels';
import { usePagination } from '../hooks/usePagination';
import { edgeFunctionError } from '../utils/edgeFunctionError';
import { fetchAllRpc } from '../utils/fetchAll';
import { SESSION_EXPIRED_MESSAGE, UserFacingError, toUserMessage } from '../utils/errors';
import {
  filterPlatformUsers,
  formatDate,
  planBadgeClass,
  resolvePlanLabel,
  roleBadgeClass,
  type EditState,
  type LegalAcceptanceRow,
  type PlatformUser,
} from './platform-admin/platformAdminHelpers';
import { DeleteConfirmModal, EditUserModal } from './platform-admin/PlatformUserModals';
import { ErrorAlertsPanel } from './platform-admin/ErrorAlertsPanel';

export function PlatformAdminView() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PlatformUser | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [billingWarning, setBillingWarning] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAllRpc<PlatformUser>('users', () => supabase.rpc('get_all_users_with_plans'), ['org_name', 'created_at', 'user_id']);
      const legalRows = await fetchAllRpc<LegalAcceptanceRow>('legal acceptance', () => supabase.rpc('get_users_legal_acceptance'), ['user_id']);
      const acceptance = new Map<string, LegalAcceptanceRow>();
      for (const row of legalRows) {
        acceptance.set(row.user_id, row);
      }
      setUsers(data.map((u) => ({
        ...u,
        terms_version: acceptance.get(u.user_id)?.terms_version ?? null,
        terms_accepted_at: acceptance.get(u.user_id)?.terms_accepted_at ?? null,
      })));
    } catch (err) {
      setError(toUserMessage(err, 'Could not load users.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    // Check if any Stripe customers exist but no webhook events have been processed.
    (async () => {
      try {
        const [{ count: customerCount }, { count: eventCount }] = await Promise.all([
          supabase.from('stripe_customers').select('*', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('stripe_processed_events').select('*', { count: 'exact', head: true }),
        ]);
        setBillingWarning((customerCount ?? 0) > 0 && (eventCount ?? 0) === 0);
      } catch {
        // Non-critical check.
      }
    })();
  }, [loadUsers]);

  const filtered = filterPlatformUsers(users, search);

  const { pageItems, paginationProps } = usePagination(filtered, 25);

  const orgCount = new Set(users.map((u) => u.organization_id).filter(Boolean)).size;
  const trialCount = users.filter((u) => u.plan_status === 'trialing').length;
  const enterpriseCount = users.filter((u) => u.plan_key === 'enterprise' && u.plan_status === 'active').length;

  const openEditModal = (user: PlatformUser) => {
    setEditState({
      user,
      fullName: user.full_name || '',
      role: (user.role as UserRole) || 'view',
      showPassword: false,
      newPassword: '',
    });
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editState) return;
    setEditSaving(true);
    setEditError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/platform-admin-edit-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          targetUserId: editState.user.user_id,
          fullName: editState.fullName,
          role: editState.role,
          newPassword: editState.showPassword && editState.newPassword ? editState.newPassword : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw edgeFunctionError(res, data, 'Failed to update user.', {
          WEAK_PASSWORD: 'Password must be at least 12 characters.',
          NOT_ADMIN: 'Only platform admins can edit users.',
          NOT_FOUND: 'User not found.',
          SELF_DEMOTE: 'You cannot demote yourself.',
        });
      }

      setActionSuccess('User updated successfully.');
      setTimeout(() => setActionSuccess(''), 3000);
      setEditState(null);
      await loadUsers();
    } catch (err) {
      setEditError(toUserMessage(err, 'Failed to update user.'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/platform-admin-delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ targetUserId: deleteTarget.user_id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw edgeFunctionError(res, data, 'Failed to delete user.', {
          SELF_DELETE: 'You cannot delete your own account from here.',
          NOT_FOUND: 'User not found.',
        });
      }

      setActionSuccess('User deleted successfully.');
      setTimeout(() => setActionSuccess(''), 3000);
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Failed to delete user.'));
    } finally {
      setDeleteSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-8 py-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">Platform Admin</h1>
                  <p className="text-slate-300">All users and their plan across all organizations</p>
                </div>
              </div>
              <button
                onClick={loadUsers}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition backdrop-blur disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="px-8 py-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                <div className="flex items-center gap-3 mb-1">
                  <Users className="w-5 h-5 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-600">Total Users</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">{users.length}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-5 border border-blue-200">
                <div className="flex items-center gap-3 mb-1">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-700">Organizations</span>
                </div>
                <p className="text-3xl font-bold text-blue-900">{orgCount}</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-5 border border-emerald-200">
                <div className="flex items-center gap-3 mb-1">
                  <Shield className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-700">Enterprise / Trial</span>
                </div>
                <p className="text-3xl font-bold text-emerald-900">
                  {enterpriseCount}<span className="text-lg text-emerald-600"> / {trialCount}</span>
                </p>
              </div>
            </div>

            {actionSuccess && (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-6">
                <span className="text-sm text-emerald-700 font-medium">{actionSuccess}</span>
              </div>
            )}

            <div className="relative mb-6">
              <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, email, organization, role, or plan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none text-slate-800"
              />
            </div>

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-700" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <Users className="w-14 h-14 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 font-semibold text-lg">No users found</p>
                <p className="text-sm text-slate-400 mt-1">
                  {search ? 'Try adjusting your search.' : 'No users in the system yet.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold">User</th>
                      <th className="text-left px-4 py-3 font-bold">Organization</th>
                      <th className="text-left px-4 py-3 font-bold">Role</th>
                      <th className="text-left px-4 py-3 font-bold">Plan</th>
                      <th className="text-left px-4 py-3 font-bold">Status</th>
                      <th className="text-left px-4 py-3 font-bold">Created</th>
                      <th className="text-left px-4 py-3 font-bold">Terms accepted</th>
                      <th className="text-right px-4 py-3 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageItems.map((user) => (
                      <tr key={user.user_id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">
                            {user.full_name || (user.email ? user.email.split('@')[0] : 'No name set')}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                            <Mail className="w-3 h-3" />
                            {user.email || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-700 font-medium">{user.org_name || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${roleBadgeClass(user.role)}`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${planBadgeClass(user.plan_key, user.plan_status)}`}>
                            {resolvePlanLabel(user.plan_key, user.plan_status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {user.plan_status || '—'}
                          {user.trial_ends_at && (
                            <div className="text-xs text-slate-400">
                              trial ends {formatDate(user.trial_ends_at)}
                            </div>
                          )}
                          {user.current_period_end && (
                            <div className="text-xs text-slate-400">
                              renews {formatDate(user.current_period_end)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {user.terms_version ? (
                            <>
                              {user.terms_version}
                              <div className="text-xs text-slate-400">{formatDate(user.terms_accepted_at ?? null)}</div>
                            </>
                          ) : (
                            <span className="text-amber-700">Not yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditModal(user)}
                              className="p-2 rounded-lg hover:bg-slate-200 text-slate-600 transition"
                              title="Edit user"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(user)}
                              className="p-2 rounded-lg hover:bg-red-100 text-red-600 transition"
                              title="Delete user"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4">
                  <Pagination {...paginationProps} />
                </div>
              </div>
            )}

            {filtered.length > 0 && (
              <p className="mt-4 text-xs text-slate-400 text-center">
                {filtered.length} of {users.length} users match across {orgCount} organization{orgCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
        {billingWarning && (
          <div className="mt-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-900">Stripe webhook not receiving events</p>
              <p className="text-sm text-amber-800 mt-1">
                There are Stripe customers but zero processed webhook events. Ensure the webhook endpoint is configured in the Stripe dashboard
                pointing to <code className="bg-amber-100 px-1 rounded">/functions/v1/stripe-webhook</code> with the correct signing secret.
                Subscriptions and invoices will not sync until this is fixed.
              </p>
            </div>
          </div>
        )}
        <div className="mt-6">
          <DataHealthPanel scope="platform" />
        </div>
        <div className="mt-6">
          <ErrorAlertsPanel />
        </div>
      </div>

      {editState && (
        <EditUserModal
          state={editState}
          setState={setEditState}
          saving={editSaving}
          error={editError}
          onClose={() => setEditState(null)}
          onSave={handleEditSave}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          saving={deleteSaving}
          error={deleteError}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}


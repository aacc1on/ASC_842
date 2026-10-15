import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getErrorMessage, SESSION_EXPIRED_MESSAGE, UserFacingError } from '../utils/errors';
import { edgeFunctionError } from '../utils/edgeFunctionError';
import type { ManagedUser, RoleChangeModalState } from '../components/user/types';
import {
  EMPTY_ADD_FORM,
  VIEW_PERMISSIONS,
  permissionsForRole,
  toManagedUser,
  type AddUserForm,
  type EditUserForm,
} from '../utils/managedUserRoles';
import { currentOrgId } from '../utils/currentOrg';

interface UseManagedUsersArgs {
  setError: (msg: string) => void;
  setSaveSuccess: (v: boolean) => void;
  logActivity: (type: string, description: string) => Promise<void>;
}

interface UseManagedUsersResult {
  managedUsers: ManagedUser[];
  filteredManagedUsers: ManagedUser[];
  managementLoading: boolean;
  managementSearch: string;
  setManagementSearch: (v: string) => void;
  loadManagedUsers: () => Promise<void>;
  addUserModal: boolean;
  setAddUserModal: (v: boolean) => void;
  openEditModal: (user: ManagedUser) => void;
  setRoleChangeModal: (state: RoleChangeModalState | null) => void;
  roleChangeModal: RoleChangeModalState | null;
  roleChanging: boolean;
  handleRoleChange: () => Promise<void>;
  addUserForm: AddUserForm;
  setAddUserForm: React.Dispatch<React.SetStateAction<AddUserForm>>;
  addingUser: boolean;
  showAddPassword: boolean;
  setShowAddPassword: (v: boolean) => void;
  handleAddUser: () => Promise<void>;
  addUserError: string;
  clearAddUserError: () => void;
  editUserModal: ManagedUser | null;
  setEditUserModal: (user: ManagedUser | null) => void;
  editUserForm: EditUserForm;
  setEditUserForm: React.Dispatch<React.SetStateAction<EditUserForm>>;
  editingUser: boolean;
  showEditPassword: boolean;
  setShowEditPassword: (v: boolean) => void;
  handleEditUser: () => Promise<void>;
  deleteConfirmModal: ManagedUser | null;
  setDeleteConfirmModal: (user: ManagedUser | null) => void;
  deletingUser: boolean;
  handleDeleteUser: () => Promise<void>;
}


export function useManagedUsers({
  setError,
  setSaveSuccess,
  logActivity,
}: UseManagedUsersArgs): UseManagedUsersResult {
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementSearch, setManagementSearch] = useState('');
  const [addUserModal, setAddUserModal] = useState(false);
  const [addUserForm, setAddUserForm] = useState<AddUserForm>(EMPTY_ADD_FORM);
  const [addingUser, setAddingUser] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [editUserModal, setEditUserModal] = useState<ManagedUser | null>(null);
  const [editUserForm, setEditUserForm] = useState<EditUserForm>({
    full_name: '',
    company_name: '',
    job_title: '',
    role: 'view',
    permissions: { ...VIEW_PERMISSIONS },
    password: '',
  });
  const [editingUser, setEditingUser] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<ManagedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [roleChangeModal, setRoleChangeModal] = useState<RoleChangeModalState | null>(null);
  const [roleChanging, setRoleChanging] = useState(false);
  const [addUserError, setAddUserError] = useState('');

  const filteredManagedUsers = useMemo(() => {
    const q = managementSearch.trim().toLowerCase();
    if (!q) return managedUsers;
    return managedUsers.filter((u) =>
      [u.email, u.full_name, u.company_name, u.job_title]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [managedUsers, managementSearch]);

  const loadManagedUsers = useCallback(async () => {
    setManagementLoading(true);
    setError('');
    try {
      const orgId = await currentOrgId();
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setManagedUsers((data || []).map((r) => toManagedUser(r as Record<string, unknown>)));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setManagementLoading(false);
    }
  }, [setError]);

  const openEditModal = useCallback((user: ManagedUser) => {
    setEditUserModal(user);
    setEditUserForm({
      full_name: user.full_name,
      company_name: user.company_name,
      job_title: user.job_title,
      role: user.role,
      permissions: { ...user.permissions },
      password: '',
    });
    setShowEditPassword(false);
  }, []);

  const clearAddUserError = useCallback(() => setAddUserError(''), []);

  const handleAddUser = useCallback(async () => {
    setAddingUser(true);
    setAddUserError('');
    setError('');
    try {
      if (!addUserForm.email || !addUserForm.password) {
        throw new UserFacingError('Email and password are required');
      }
      if (addUserForm.password.length < 12) {
        throw new UserFacingError('Password must be at least 12 characters');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/recreate-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: addUserForm.email,
          password: addUserForm.password,
          role: addUserForm.role,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const planRestricted = res.status === 403 && typeof data.error === 'string' && data.error.includes('Enterprise');
        const code = data.code ?? (res.status === 409 ? 'EMAIL_EXISTS' : planRestricted ? 'PLAN_RESTRICTED' : undefined);
        throw edgeFunctionError(res, { ...data, code }, 'Failed to create user. Please try again.', {
          PLAN_RESTRICTED: 'Adding users requires the Enterprise plan. Please upgrade to add team members.',
          EMAIL_EXISTS: 'This email is already registered. Use a different email or remove the existing user first.',
          WEAK_PASSWORD: 'Password must be at least 12 characters.',
          INVALID_EMAIL: 'Please enter a valid email address.',
        }, 'An unexpected error occurred. Please try again or contact support if it continues.');
      }

      // The edge function creates the auth user and sets the role on the
      // auto-generated profile row. Update the remaining display fields.
      if (data.userId && addUserForm.full_name) {
        await supabase
          .from('user_profiles')
          .update({ full_name: addUserForm.full_name })
          .eq('user_id', data.userId);
      }

      await logActivity(
        'user_create',
        `Created user ${addUserForm.email} with role ${addUserForm.role}`,
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setAddUserModal(false);
      setAddUserForm(EMPTY_ADD_FORM);
      setShowAddPassword(false);
      await loadManagedUsers();
    } catch (err) {
      setAddUserError(getErrorMessage(err, 'Failed to create user. Please try again.'));
    } finally {
      setAddingUser(false);
    }
  }, [addUserForm, setError, setSaveSuccess, logActivity, loadManagedUsers]);

  const handleEditUser = useCallback(async () => {
    if (!editUserModal) return;
    setEditingUser(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          full_name: editUserForm.full_name,
          company_name: editUserForm.company_name,
          job_title: editUserForm.job_title,
        })
        .eq('user_id', editUserModal.user_id);

      if (updateError) throw updateError;

      // Role and permissions are privileged columns. They are only writable
      // through a server-side function that verifies the caller is an admin of
      // the same organisation.
      if (editUserForm.role !== editUserModal.role) {
        const { error: roleError } = await supabase.rpc('admin_set_user_role', {
          target_user_id: editUserModal.user_id,
          new_role: editUserForm.role,
          new_permissions: editUserForm.permissions,
        });
        if (roleError) throw roleError;
      }

      if (showEditPassword && editUserForm.password) {
        if (editUserForm.password.length < 12) {
          throw new UserFacingError('Password must be at least 12 characters');
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${supabaseUrl}/functions/v1/admin-update-user-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            user_id: editUserModal.user_id,
            new_password: editUserForm.password,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw edgeFunctionError(res, data, 'Failed to update the password. Please try again.');
      }

      await logActivity('user_edit', `Updated user ${editUserModal.email}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setEditUserModal(null);
      setShowEditPassword(false);
      await loadManagedUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setEditingUser(false);
    }
  }, [editUserModal, editUserForm, showEditPassword, setError, setSaveSuccess, logActivity, loadManagedUsers]);

  const handleRoleChange = useCallback(async () => {
    if (!roleChangeModal) return;
    setRoleChanging(true);
    setError('');
    try {
      const newPermissions = permissionsForRole(roleChangeModal.newRole);
      const { error: updateError } = await supabase.rpc('admin_set_user_role', {
        target_user_id: roleChangeModal.user_id,
        new_role: roleChangeModal.newRole,
        new_permissions: newPermissions,
      });

      if (updateError) throw updateError;

      await logActivity(
        'role_change',
        `Changed ${roleChangeModal.email} role from ${roleChangeModal.currentRole} to ${roleChangeModal.newRole}`,
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setRoleChangeModal(null);
      await loadManagedUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRoleChanging(false);
    }
  }, [roleChangeModal, setError, setSaveSuccess, logActivity, loadManagedUsers]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteConfirmModal) return;
    setDeletingUser(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/remove-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          targetUserId: deleteConfirmModal.user_id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw edgeFunctionError(res, data, 'Failed to remove the user. Please try again.');

      await logActivity('user_delete', `Removed user ${deleteConfirmModal.email}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setDeleteConfirmModal(null);
      await loadManagedUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingUser(false);
    }
  }, [deleteConfirmModal, setError, setSaveSuccess, logActivity, loadManagedUsers]);

  return {
    managedUsers,
    addUserError,
    clearAddUserError,
    filteredManagedUsers,
    managementLoading,
    managementSearch,
    setManagementSearch,
    loadManagedUsers,
    addUserModal,
    setAddUserModal,
    openEditModal,
    setRoleChangeModal,
    roleChangeModal,
    roleChanging,
    handleRoleChange,
    addUserForm,
    setAddUserForm,
    addingUser,
    showAddPassword,
    setShowAddPassword,
    handleAddUser,
    editUserModal,
    setEditUserModal,
    editUserForm,
    setEditUserForm,
    editingUser,
    showEditPassword,
    setShowEditPassword,
    handleEditUser,
    deleteConfirmModal,
    setDeleteConfirmModal,
    deletingUser,
    handleDeleteUser,
  };
}

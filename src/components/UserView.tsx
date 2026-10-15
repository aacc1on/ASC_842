import { useState, useEffect } from 'react';
import { User, Crown, Settings, Eye, Save, CheckCircle, AlertCircle, Users, Database, FileText, AlertOctagon } from 'lucide-react';
import type { UserViewProps, ManagedUser, RoleChangeModalState } from './user/types';
import { ROLE_CONFIG } from './user/types';
import { useUserProfile } from '../hooks/useUserProfile';
import { useManagedUsers } from '../hooks/useManagedUsers';
import { useBackup } from '../hooks/useBackup';
import { ProfileTab } from './user/ProfileTab';
import { ManagementTab } from './user/ManagementTab';
import { BackupTab } from './user/BackupTab';
import { PasswordChangeModal } from './user/PasswordChangeModal';
import { RoleChangeModal } from './user/RoleChangeModal';
import { AddUserModal } from './user/AddUserModal';
import { EditUserModal } from './user/EditUserModal';
import { DeleteUserModal } from './user/DeleteUserModal';
import { AuditLogTab } from './user/AuditLogTab';
import { ErrorLogTab } from './user/ErrorLogTab';
import { UpgradeCard } from './UpgradeCard';
import { hasFeature, type PlanFeature } from '../utils/planFeatures';
import { useUserCapacity } from '../hooks/useUserCapacity';

export function UserView({ userEmail, planKey, features }: UserViewProps & { features?: Record<PlanFeature, boolean> }) {
  const [activeTab, setActiveTab] = useState<'profile' | 'management' | 'backup' | 'audit' | 'errors'>('profile');
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const profile = useUserProfile({ setError, setSaveSuccess });
  const management = useManagedUsers({ setError, setSaveSuccess, logActivity: profile.logActivity });
  const backup = useBackup();
  const { loadUserData } = profile;
  const { loadManagedUsers } = management;
  const { loadBackupCounts } = backup;
  const capacity = useUserCapacity(
    activeTab === 'management' && profile.profile?.role === 'admin',
    management.managedUsers.length,
  );

  // Load the signed-in user's profile + activity log on mount.
  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  // Load managed users whenever the management tab is opened by an admin.
  useEffect(() => {
    if (activeTab === 'management' && profile.profile?.role === 'admin') {
      loadManagedUsers();
    }
  }, [activeTab, profile.profile?.role, loadManagedUsers]);

  // Load backup row counts the first time the backup tab is opened by an admin.
  useEffect(() => {
    if (
      activeTab === 'backup' &&
      profile.profile?.role === 'admin' &&
      !backup.backupCounts &&
      !backup.backupCountsLoading
    ) {
      loadBackupCounts();
    }
  }, [activeTab, profile.profile?.role, backup.backupCounts, backup.backupCountsLoading, loadBackupCounts]);

  if (profile.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!profile.profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-slate-700">Failed to load profile</p>
        </div>
      </div>
    );
  }

  const currentProfile = profile.profile;
  const canManageUsers = currentProfile.role === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {saveSuccess && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-green-700 font-medium">Changes saved successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-12">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg">
                  <User className="w-10 h-10 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">
                    {currentProfile.full_name || 'User Profile'}
                  </h1>
                  <p className="text-blue-100">Manage your account settings and preferences</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                      currentProfile.role === 'admin' ? 'bg-red-500/20 text-white border border-red-300/40' :
                      currentProfile.role === 'manage' ? 'bg-blue-500/20 text-white border border-blue-300/40' :
                      'bg-white/20 text-white border border-white/40'
                    }`}>
                      {currentProfile.role === 'admin' && <Crown className="w-3 h-3" />}
                      {currentProfile.role === 'manage' && <Settings className="w-3 h-3" />}
                      {currentProfile.role === 'view' && <Eye className="w-3 h-3" />}
                      {ROLE_CONFIG[currentProfile.role].label}
                    </span>
                  </div>
                </div>
              </div>
              {activeTab === 'profile' && (
                <button
                  onClick={profile.handleSaveProfile}
                  disabled={profile.saving}
                  className="flex items-center gap-2 px-6 py-3 bg-white text-blue-600 hover:bg-blue-50 font-semibold rounded-lg transition shadow-md hover:shadow-lg disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  {profile.saving ? 'Saving...' : 'Save All Changes'}
                </button>
              )}
            </div>
          </div>

          {canManageUsers && (
            <div className="border-b border-slate-200 bg-slate-50">
              <div className="flex px-8">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`px-6 py-4 font-semibold text-sm border-b-2 transition ${
                    activeTab === 'profile'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    My Profile
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('management')}
                  className={`px-6 py-4 font-semibold text-sm border-b-2 transition ${
                    activeTab === 'management'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    User Management
                    <span className="ml-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                      {management.managedUsers.length}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('backup')}
                  className={`px-6 py-4 font-semibold text-sm border-b-2 transition ${
                    activeTab === 'backup'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Backup
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`px-6 py-4 font-semibold text-sm border-b-2 transition ${
                    activeTab === 'audit'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Audit Log
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('errors')}
                  className={`px-6 py-4 font-semibold text-sm border-b-2 transition ${
                    activeTab === 'errors'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <AlertOctagon className="w-4 h-4" />
                    Error Log
                  </span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <ProfileTab
              profile={currentProfile}
              activityLogs={profile.activityLogs}
              userEmail={userEmail}
              updateProfile={profile.updateProfile}
              onOpenPasswordModal={() => profile.setPasswordModal(true)}
            />
          )}

          {activeTab === 'management' && canManageUsers && (
            hasFeature(planKey, 'multi_user') || features?.multi_user ? (
              <ManagementTab
                profile={currentProfile}
                managedUsers={management.managedUsers}
                filteredManagedUsers={management.filteredManagedUsers}
                managementLoading={management.managementLoading}
                managementSearch={management.managementSearch}
                setManagementSearch={management.setManagementSearch}
                onAddUserClick={() => management.setAddUserModal(true)}
                onEditUserClick={management.openEditModal}
                onDeleteUserClick={(user: ManagedUser) => management.setDeleteConfirmModal(user)}
                onRoleSelect={(state: RoleChangeModalState) => management.setRoleChangeModal(state)}
                planKey={planKey}
                capacity={capacity}
              />
            ) : (
              <UpgradeCard featureName="User Management" requiredPlan="Enterprise" description="Adding multiple users with team roles is available on the Enterprise plan. Your current plan supports a single user." />
            )
          )}

          {activeTab === 'backup' && canManageUsers && (
            <BackupTab
              backupLoading={backup.backupLoading}
              backupCounts={backup.backupCounts}
              backupCountsLoading={backup.backupCountsLoading}
              lastBackupAt={backup.lastBackupAt}
              backupMessage={backup.backupMessage}
              onDownload={backup.handleDownloadBackup}
              onRefreshCounts={backup.loadBackupCounts}
            />
          )}

          {activeTab === 'audit' && canManageUsers && (
            <AuditLogTab onError={setError} />
          )}

          {activeTab === 'errors' && canManageUsers && (
            <ErrorLogTab onError={setError} />
          )}
        </div>
      </div>

      {profile.passwordModal && (
        <PasswordChangeModal
          currentPassword={profile.currentPassword}
          setCurrentPassword={profile.setCurrentPassword}
          newPassword={profile.newPassword}
          setNewPassword={profile.setNewPassword}
          confirmPassword={profile.confirmPassword}
          setConfirmPassword={profile.setConfirmPassword}
          saving={profile.saving}
          error={error}
          onClose={() => {
            profile.setPasswordModal(false);
            profile.setNewPassword('');
            profile.setConfirmPassword('');
            profile.setCurrentPassword('');
            setError('');
          }}
          onSubmit={profile.handlePasswordChange}
        />
      )}

      {management.roleChangeModal && (
        <RoleChangeModal
          modalState={management.roleChangeModal}
          roleChanging={management.roleChanging}
          onClose={() => management.setRoleChangeModal(null)}
          onConfirm={management.handleRoleChange}
        />
      )}

      {management.addUserModal && (
        <AddUserModal
          form={management.addUserForm}
          setForm={management.setAddUserForm}
          addingUser={management.addingUser}
          showPassword={management.showAddPassword}
          setShowPassword={management.setShowAddPassword}
          error={management.addUserError}
          onClose={() => {
            management.setAddUserModal(false);
            management.setAddUserForm({ email: '', password: '', full_name: '', role: 'view' });
            management.clearAddUserError();
          }}
          onSubmit={management.handleAddUser}
        />
      )}

      {management.editUserModal && (
        <EditUserModal
          user={management.editUserModal}
          form={management.editUserForm}
          setForm={management.setEditUserForm}
          editingUser={management.editingUser}
          showPassword={management.showEditPassword}
          setShowPassword={management.setShowEditPassword}
          onClose={() => management.setEditUserModal(null)}
          onSubmit={management.handleEditUser}
        />
      )}

      {management.deleteConfirmModal && (
        <DeleteUserModal
          user={management.deleteConfirmModal}
          deletingUser={management.deletingUser}
          onClose={() => management.setDeleteConfirmModal(null)}
          onConfirm={management.handleDeleteUser}
        />
      )}
    </div>
  );
}

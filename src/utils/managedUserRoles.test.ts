import { describe, it, expect } from 'vitest';
import { EMPTY_ADD_FORM, VIEW_PERMISSIONS, permissionsForRole, toManagedUser } from './managedUserRoles';

describe('managedUserRoles', () => {
  it('gives admins every permission and viewers none of the write permissions', () => {
    expect(Object.values(permissionsForRole('admin')).every(Boolean)).toBe(true);
    const view = permissionsForRole('view');
    expect(view).toEqual(VIEW_PERMISSIONS);
    expect(view.create_edit_leases).toBe(false);
    expect(view.manage_user_roles).toBe(false);
  });

  it('returns a fresh copy so callers cannot mutate the shared defaults', () => {
    const view = permissionsForRole('view');
    view.create_edit_leases = true;
    expect(VIEW_PERMISSIONS.create_edit_leases).toBe(false);
    expect(permissionsForRole('manage')).not.toBe(permissionsForRole('manage'));
  });

  it('starts the add-user form empty with the view role', () => {
    expect(EMPTY_ADD_FORM).toEqual({ email: '', password: '', full_name: '', role: 'view' });
  });

  it('maps database rows to managed users with safe defaults', () => {
    const user = toManagedUser({ user_id: 'u1', email: null, role: null, permissions: null });
    expect(user).toEqual({
      user_id: 'u1',
      email: '',
      full_name: '',
      company_name: '',
      job_title: '',
      role: 'view',
      permissions: VIEW_PERMISSIONS,
      created_at: '',
    });
    expect(user.permissions).not.toBe(VIEW_PERMISSIONS);
  });
});

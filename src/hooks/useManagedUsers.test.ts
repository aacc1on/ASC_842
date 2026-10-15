import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFakeSupabase, RpcError, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useManagedUsers } from './useManagedUsers';
import type { ManagedUser } from '../components/user/types';
import { permissionsForRole, VIEW_PERMISSIONS, EMPTY_ADD_FORM } from '../utils/managedUserRoles';
import { currentOrgId } from '../utils/currentOrg';

beforeEach(() => { vi.mocked(currentOrgId).mockResolvedValue('org-1'); });

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const BASE = 'http://localhost:54321/functions/v1';
const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';
const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';
const NETWORK = 'We could not reach the server. Check your internet connection and try again.';

type Fake = ReturnType<typeof createFakeSupabase>;

function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(),
    headers: new Headers(headers),
  };
}

let tables: Tables;
let fake: Fake;
let fetchMock: ReturnType<typeof vi.fn>;
let setError: ReturnType<typeof vi.fn<(m: string) => void>>;
let setSaveSuccess: ReturnType<typeof vi.fn<(v: boolean) => void>>;
let logActivity: ReturnType<typeof vi.fn<(t: string, d: string) => Promise<void>>>;

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  fake = createFakeSupabase(tables, {
    userId: 'admin-1',
    email: 'admin@acme.test',
    rpc: { admin_set_user_role: () => null },
    ...opts,
  });
  h.client = fake as unknown as Record<string, unknown>;
}

function render() {
  return renderHook(() => useManagedUsers({ setError, setSaveSuccess, logActivity }));
}

const alice: ManagedUser = {
  user_id: 'u-alice',
  email: 'alice@acme.test',
  full_name: 'Alice',
  company_name: 'Acme',
  job_title: 'CFO',
  role: 'view',
  permissions: { ...VIEW_PERMISSIONS },
  created_at: '2024-01-02',
};

beforeEach(() => {
  tables = {
    user_profiles: [
      { user_id: 'u-bob', email: 'bob@acme.test', full_name: 'Bob', role: 'manage', created_at: '2024-02-01', organization_id: 'org-1' },
      { user_id: 'u-alice', email: 'alice@acme.test', full_name: 'Alice', company_name: 'Acme', job_title: 'CFO', role: 'view', created_at: '2024-01-02', organization_id: 'org-1' },
      { user_id: 'u-carol', email: null, full_name: null, role: null, permissions: null, created_at: '2024-03-01', organization_id: 'org-1' },
    ],
  };
  setup();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setError = vi.fn<(m: string) => void>();
  setSaveSuccess = vi.fn<(v: boolean) => void>();
  logActivity = vi.fn<(t: string, d: string) => Promise<void>>(async () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useManagedUsers – loading', () => {
  it('starts idle with empty lists', () => {
    const { result } = render();
    expect(result.current.managedUsers).toEqual([]);
    expect(result.current.filteredManagedUsers).toEqual([]);
    expect(result.current.managementLoading).toBe(false);
  });

  it('loads users ordered by created_at and maps nulls to defaults', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadManagedUsers(); });
    expect(setError).toHaveBeenCalledWith('');
    expect(result.current.managementLoading).toBe(false);
    expect(result.current.managedUsers.map((u) => u.user_id)).toEqual(['u-alice', 'u-bob', 'u-carol']);
    const carol = result.current.managedUsers[2];
    expect(carol).toMatchObject({ email: '', full_name: '', role: 'view' });
    expect(carol.permissions).toEqual(VIEW_PERMISSIONS);
  });

  it('handles an empty table', async () => {
    tables.user_profiles = [];
    const { result } = render();
    await act(async () => { await result.current.loadManagedUsers(); });
    expect(result.current.managedUsers).toEqual([]);
  });

  it('reports a sanitized error when the query fails', async () => {
    setup({ failures: { select: { user_profiles: 'permission denied for table user_profiles' } } });
    const { result } = render();
    await act(async () => { await result.current.loadManagedUsers(); });
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(result.current.managedUsers).toEqual([]);
    expect(result.current.managementLoading).toBe(false);
  });

  it('filters users by search across email, name, company and title', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadManagedUsers(); });
    act(() => result.current.setManagementSearch('  cfo '));
    expect(result.current.filteredManagedUsers.map((u) => u.user_id)).toEqual(['u-alice']);
    act(() => result.current.setManagementSearch('BOB@'));
    expect(result.current.filteredManagedUsers.map((u) => u.user_id)).toEqual(['u-bob']);
    act(() => result.current.setManagementSearch('nobody'));
    expect(result.current.filteredManagedUsers).toEqual([]);
    act(() => result.current.setManagementSearch('   '));
    expect(result.current.filteredManagedUsers).toHaveLength(3);
  });
});

describe('useManagedUsers – handleAddUser', () => {
  async function addWith(form: Partial<typeof EMPTY_ADD_FORM>) {
    const hook = render();
    act(() => hook.result.current.setAddUserForm({ ...EMPTY_ADD_FORM, ...form }));
    await act(async () => { await hook.result.current.handleAddUser(); });
    return hook;
  }
  const valid = { email: 'new@acme.test', password: 'correct-horse-battery', role: 'manage' as const };

  it('requires email and password', async () => {
    const { result } = await addWith({ email: 'x@y.z' });
    expect(result.current.addUserError).toBe('Email and password are required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.addingUser).toBe(false);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    const { result } = await addWith({ email: 'x@y.z', password: 'short' });
    expect(result.current.addUserError).toBe('Password must be at least 12 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when there is no session', async () => {
    setup({ signedOut: true });
    const { result } = await addWith(valid);
    expect(result.current.addUserError).toBe(SESSION_EXPIRED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the user via recreate-user, sets the name, logs, resets and reloads', async () => {
    fetchMock.mockResolvedValue(resp(200, { userId: 'u-bob' }));
    const hook = render();
    act(() => {
      hook.result.current.setAddUserModal(true);
      hook.result.current.setShowAddPassword(true);
      hook.result.current.setAddUserForm({ ...valid, full_name: 'Bobby' });
    });
    await act(async () => { await hook.result.current.handleAddUser(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/recreate-user`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({ email: valid.email, password: valid.password, role: 'manage' });

    expect(fake.writes).toContainEqual({ op: 'update', table: 'user_profiles', values: { full_name: 'Bobby' }, matched: 1 });
    expect(logActivity).toHaveBeenCalledWith('user_create', 'Created user new@acme.test with role manage');
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    const r = hook.result.current;
    expect(r.addUserError).toBe('');
    expect(r.addUserModal).toBe(false);
    expect(r.showAddPassword).toBe(false);
    expect(r.addUserForm).toEqual(EMPTY_ADD_FORM);
    expect(r.managedUsers.find((u) => u.user_id === 'u-bob')?.full_name).toBe('Bobby');
  });

  it('skips the profile update when no full name was supplied', async () => {
    fetchMock.mockResolvedValue(resp(200, { userId: 'u-new' }));
    await addWith(valid);
    expect(fake.writes).toEqual([]);
    expect(logActivity).toHaveBeenCalled();
  });

  it.each([
    ['429 with Retry-After header', resp(429, {}, { 'Retry-After': '30' }), 'Too many requests. Please wait 30 seconds and try again.'],
    ['429 with retryAfter body', resp(429, { retryAfter: 120 }), 'Too many requests. Please wait 2 minutes and try again.'],
    ['429 without hint', resp(429, {}), 'Too many requests. Please wait a few minutes and try again.'],
    ['429 with server message', resp(429, { error: 'Slow down please' }), 'Slow down please'],
    ['PLAN_RESTRICTED code', resp(403, { code: 'PLAN_RESTRICTED', error: 'x' }), 'Adding users requires the Enterprise plan. Please upgrade to add team members.'],
    ['403 mentioning Enterprise', resp(403, { error: 'Requires Enterprise plan' }), 'Adding users requires the Enterprise plan. Please upgrade to add team members.'],
    ['EMAIL_EXISTS code', resp(400, { code: 'EMAIL_EXISTS' }), 'This email is already registered. Use a different email or remove the existing user first.'],
    ['409 status', resp(409, { error: 'dup' }), 'This email is already registered. Use a different email or remove the existing user first.'],
    ['WEAK_PASSWORD', resp(400, { code: 'WEAK_PASSWORD' }), 'Password must be at least 12 characters.'],
    ['INVALID_EMAIL', resp(400, { code: 'INVALID_EMAIL' }), 'Please enter a valid email address.'],
    ['AUTH_EXPIRED', resp(400, { code: 'AUTH_EXPIRED' }), 'Your session has expired. Please sign in again.'],
    ['401 status', resp(401, {}), 'Your session has expired. Please sign in again.'],
    ['500 status', resp(500, { error: 'stack trace...' }), 'An unexpected error occurred. Please try again or contact support if it continues.'],
    ['other status with server error', resp(400, { error: 'Role not allowed' }), 'Role not allowed'],
    ['other status without body', resp(400, {}), 'Failed to create user. Please try again.'],
    ['403 without Enterprise', resp(403, { error: 'Forbidden' }), 'Forbidden'],
  ])('maps %s', async (_label, response, message) => {
    fetchMock.mockResolvedValue(response);
    const { result } = await addWith(valid);
    expect(result.current.addUserError).toBe(message);
    expect(setSaveSuccess).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(result.current.addingUser).toBe(false);
  });

  it('surfaces a network failure and clears it on demand', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await addWith(valid);
    expect(result.current.addUserError).toBe(NETWORK);
    act(() => result.current.clearAddUserError());
    expect(result.current.addUserError).toBe('');
  });

  it('stringifies non-Error throws', async () => {
    fetchMock.mockRejectedValue('kaboom');
    const { result } = await addWith(valid);
    expect(result.current.addUserError).toBe('Failed to create user. Please try again.');
  });
});

describe('useManagedUsers – handleEditUser', () => {
  async function openEdit(user: ManagedUser = alice) {
    const hook = render();
    act(() => hook.result.current.openEditModal(user));
    return hook;
  }

  it('is a no-op without an open edit modal', async () => {
    const { result } = render();
    await act(async () => { await result.current.handleEditUser(); });
    expect(setError).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it('openEditModal seeds the form from the user', async () => {
    const { result } = await openEdit();
    act(() => result.current.setShowEditPassword(true));
    act(() => result.current.openEditModal(alice));
    expect(result.current.editUserModal).toBe(alice);
    expect(result.current.showEditPassword).toBe(false);
    expect(result.current.editUserForm).toEqual({
      full_name: 'Alice', company_name: 'Acme', job_title: 'CFO', role: 'view', permissions: VIEW_PERMISSIONS, password: '',
    });
    expect(result.current.editUserForm.permissions).not.toBe(alice.permissions);
  });

  it('updates display fields only when role unchanged', async () => {
    const { result } = await openEdit();
    act(() => result.current.setEditUserForm((f) => ({ ...f, full_name: 'Alice B', job_title: 'CEO' })));
    await act(async () => { await result.current.handleEditUser(); });
    expect(fake.writes).toEqual([
      { op: 'update', table: 'user_profiles', values: { full_name: 'Alice B', company_name: 'Acme', job_title: 'CEO' }, matched: 1 },
    ]);
    expect(fake.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith('user_edit', 'Updated user alice@acme.test');
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.editUserModal).toBeNull();
    expect(result.current.editingUser).toBe(false);
    expect(result.current.managedUsers.find((u) => u.user_id === 'u-alice')?.full_name).toBe('Alice B');
  });

  it('calls admin_set_user_role when the role changes', async () => {
    const { result } = await openEdit();
    const perms = permissionsForRole('admin');
    act(() => result.current.setEditUserForm((f) => ({ ...f, role: 'admin', permissions: perms })));
    await act(async () => { await result.current.handleEditUser(); });
    expect(fake.calls).toEqual([
      { fn: 'admin_set_user_role', args: { target_user_id: 'u-alice', new_role: 'admin', new_permissions: perms } },
    ]);
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
  });

  it('reports a role RPC failure (permission code)', async () => {
    setup({ rpc: { admin_set_user_role: () => { throw new RpcError('nope', '42501'); } } });
    const { result } = await openEdit();
    act(() => result.current.setEditUserForm((f) => ({ ...f, role: 'manage' })));
    await act(async () => { await result.current.handleEditUser(); });
    expect(setError).toHaveBeenLastCalledWith('You do not have permission to perform this action, or your plan does not include it.');
    expect(setSaveSuccess).not.toHaveBeenCalled();
    expect(result.current.editUserModal).toBe(alice);
  });

  it('reports a profile update failure', async () => {
    setup({ failures: { write: { user_profiles: 'new row violates row-level security policy' } } });
    const { result } = await openEdit();
    await act(async () => { await result.current.handleEditUser(); });
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('ignores the password field when the password section is hidden', async () => {
    const { result } = await openEdit();
    act(() => result.current.setEditUserForm((f) => ({ ...f, password: 'x' })));
    await act(async () => { await result.current.handleEditUser(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
  });

  it('rejects short replacement passwords (after profile write)', async () => {
    const { result } = await openEdit();
    act(() => {
      result.current.setShowEditPassword(true);
      result.current.setEditUserForm((f) => ({ ...f, password: 'short' }));
    });
    await act(async () => { await result.current.handleEditUser(); });
    expect(setError).toHaveBeenLastCalledWith('Password must be at least 12 characters');
    expect(fetchMock).not.toHaveBeenCalled();
    // Documented behaviour: the profile row was already updated before validation failed.
    expect(fake.writes).toHaveLength(1);
  });

  it('updates the password via admin-update-user-password', async () => {
    fetchMock.mockResolvedValue(resp(200, { ok: true }));
    const { result } = await openEdit();
    act(() => {
      result.current.setShowEditPassword(true);
      result.current.setEditUserForm((f) => ({ ...f, password: 'a-very-long-password' }));
    });
    await act(async () => { await result.current.handleEditUser(); });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin-update-user-password`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({ user_id: 'u-alice', new_password: 'a-very-long-password' });
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.showEditPassword).toBe(false);
  });

  it.each([
    ['429', resp(429, {}, { 'Retry-After': '1' }), 'Too many requests. Please wait 1 second and try again.'],
    ['server error w/ safe message', resp(400, { error: 'Password must be stronger' }), 'Password must be stronger'],
    ['server error w/o message (fallback is sanitized)', resp(500, {}), 'Failed to update the password. Please try again.'],
  ])('password update failure: %s', async (_l, response, message) => {
    fetchMock.mockResolvedValue(response);
    const { result } = await openEdit();
    act(() => {
      result.current.setShowEditPassword(true);
      result.current.setEditUserForm((f) => ({ ...f, password: 'a-very-long-password' }));
    });
    await act(async () => { await result.current.handleEditUser(); });
    expect(setError).toHaveBeenLastCalledWith(message);
    expect(setSaveSuccess).not.toHaveBeenCalled();
  });

  it('password update without a session fails', async () => {
    setup({ signedOut: true });
    const { result } = await openEdit();
    act(() => {
      result.current.setShowEditPassword(true);
      result.current.setEditUserForm((f) => ({ ...f, password: 'a-very-long-password' }));
    });
    await act(async () => { await result.current.handleEditUser(); });
    // A missing session is explained instead of shown as a generic failure.
    expect(setError).toHaveBeenLastCalledWith(SESSION_EXPIRED);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useManagedUsers – handleRoleChange', () => {
  it('is a no-op with no modal state', async () => {
    const { result } = render();
    await act(async () => { await result.current.handleRoleChange(); });
    expect(fake.calls).toEqual([]);
    expect(setError).not.toHaveBeenCalled();
  });

  it('sets the role with the role default permissions', async () => {
    const { result } = render();
    act(() => result.current.setRoleChangeModal({ user_id: 'u-bob', email: 'bob@acme.test', full_name: 'Bob', currentRole: 'manage', newRole: 'view' }));
    expect(result.current.roleChangeModal?.newRole).toBe('view');
    await act(async () => { await result.current.handleRoleChange(); });
    expect(fake.calls).toEqual([
      { fn: 'admin_set_user_role', args: { target_user_id: 'u-bob', new_role: 'view', new_permissions: permissionsForRole('view') } },
    ]);
    expect(logActivity).toHaveBeenCalledWith('role_change', 'Changed bob@acme.test role from manage to view');
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.roleChangeModal).toBeNull();
    expect(result.current.roleChanging).toBe(false);
    expect(result.current.managedUsers).toHaveLength(3);
  });

  it('surfaces a safe RPC error message', async () => {
    setup({ rpc: { admin_set_user_role: () => { throw new RpcError('Only administrators can change roles'); } } });
    const { result } = render();
    act(() => result.current.setRoleChangeModal({ user_id: 'u-bob', email: 'b', full_name: 'B', currentRole: 'manage', newRole: 'admin' }));
    await act(async () => { await result.current.handleRoleChange(); });
    expect(setError).toHaveBeenLastCalledWith('Only administrators can change roles');
    expect(result.current.roleChangeModal).not.toBeNull();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('useManagedUsers – handleDeleteUser', () => {
  it('is a no-op with no confirmation target', async () => {
    const { result } = render();
    await act(async () => { await result.current.handleDeleteUser(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes the user via remove-user and reloads', async () => {
    fetchMock.mockResolvedValue(resp(200, { success: true }));
    const { result } = render();
    act(() => result.current.setDeleteConfirmModal(alice));
    await act(async () => { await result.current.handleDeleteUser(); });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/remove-user`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({ targetUserId: 'u-alice' });
    expect(logActivity).toHaveBeenCalledWith('user_delete', 'Removed user alice@acme.test');
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.deleteConfirmModal).toBeNull();
    expect(result.current.deletingUser).toBe(false);
    expect(result.current.managedUsers).toHaveLength(3);
  });

  it.each([
    ['429', resp(429, { retryAfter: 59 }), 'Too many requests. Please wait 59 seconds and try again.'],
    ['safe server error', resp(403, { error: 'Not allowed to remove yourself' }), 'Not allowed to remove yourself'],
    ['no message (fallback sanitized)', resp(500, {}), 'Failed to remove the user. Please try again.'],
  ])('failure: %s', async (_l, response, message) => {
    fetchMock.mockResolvedValue(response);
    const { result } = render();
    act(() => result.current.setDeleteConfirmModal(alice));
    await act(async () => { await result.current.handleDeleteUser(); });
    expect(setError).toHaveBeenLastCalledWith(message);
    expect(result.current.deleteConfirmModal).toBe(alice);
    expect(setSaveSuccess).not.toHaveBeenCalled();
  });

  it('fails without a session', async () => {
    setup({ signedOut: true });
    const { result } = render();
    act(() => result.current.setDeleteConfirmModal(alice));
    await act(async () => { await result.current.handleDeleteUser(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(SESSION_EXPIRED);
  });

  it('setEditUserModal can clear the edit target', async () => {
    const { result } = render();
    act(() => result.current.openEditModal(alice));
    act(() => result.current.setEditUserModal(null));
    expect(result.current.editUserModal).toBeNull();
  });
});

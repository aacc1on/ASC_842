import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useUserProfile } from './useUserProfile';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const GENERIC = 'Something went wrong. Please try again or contact support if it continues.';

let tables: Tables;
let fake: ReturnType<typeof createFakeSupabase>;
let signInWithPassword: ReturnType<typeof vi.fn>;
let updateUser: ReturnType<typeof vi.fn>;
let setError: ReturnType<typeof vi.fn<(m: string) => void>>;
let setSaveSuccess: ReturnType<typeof vi.fn<(v: boolean) => void>>;

function setup(opts: Partial<FakeSupabaseOptions> = {}, authOverrides: Record<string, unknown> = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', email: 'me@acme.test', ...opts });
  h.client = {
    ...fake,
    auth: { ...fake.auth, signInWithPassword, updateUser, ...authOverrides },
  };
}

const render = () => renderHook(() => useUserProfile({ setError, setSaveSuccess }));

beforeEach(() => {
  tables = {
    user_profiles: [
      {
        user_id: 'u1', email: 'profile@acme.test', full_name: 'Me', phone_number: '555', company_name: 'Acme',
        job_title: 'Controller', theme: 'dark', date_format: 'DD/MM/YYYY', currency: 'EUR', timezone: 'UTC',
        language: 'fr', email_notifications: false, lease_expiry_alerts: false, payment_reminders: false,
        monthly_reports: true, role: 'admin', permissions: { manage_user_roles: true }, created_at: '2024-01-01',
      },
      { user_id: 'u2', email: 'other@acme.test', full_name: 'Other', role: 'view', created_at: '2024-01-01' },
    ],
    user_activity_logs: [
      { id: 'l1', user_id: 'u1', activity_type: 'login', created_at: '2024-01-01' },
      { id: 'l2', user_id: 'u1', activity_type: 'edit', created_at: '2024-03-01' },
      { id: 'l3', user_id: 'u2', activity_type: 'login', created_at: '2024-04-01' },
    ],
  };
  signInWithPassword = vi.fn(() => Promise.resolve({ data: {}, error: null }));
  updateUser = vi.fn(() => Promise.resolve({ data: {}, error: null }));
  setError = vi.fn<(m: string) => void>();
  setSaveSuccess = vi.fn<(v: boolean) => void>();
  setup();
});

describe('useUserProfile – loadUserData', () => {
  it('starts in loading state', () => {
    const { result } = render();
    expect(result.current.loading).toBe(true);
    expect(result.current.profile).toBeNull();
  });

  it('loads the signed-in user profile and only their logs, newest first', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.profile).toMatchObject({
      user_id: 'u1', email: 'profile@acme.test', theme: 'dark', currency: 'EUR', language: 'fr',
      email_notifications: false, monthly_reports: true, role: 'admin',
    });
    expect(result.current.activityLogs.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('applies defaults for missing profile fields and falls back to auth email', async () => {
    tables.user_profiles = [{ user_id: 'u1', created_at: '2024-01-01' }];
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(result.current.profile).toEqual({
      user_id: 'u1', email: 'me@acme.test', full_name: '', phone_number: '', company_name: '', job_title: '',
      theme: 'light', date_format: 'MM/DD/YYYY', currency: 'USD', timezone: 'America/New_York', language: 'en',
      email_notifications: true, lease_expiry_alerts: true, payment_reminders: true, monthly_reports: false,
      role: 'view', permissions: null, created_at: '2024-01-01',
    });
  });

  it('falls back to empty email when neither profile nor auth has one', async () => {
    tables.user_profiles = [{ user_id: 'u1' }];
    setup({}, { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }) });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(result.current.profile?.email).toBe('');
  });

  it('reports a missing session', async () => {
    setup({ signedOut: true });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(setError).toHaveBeenLastCalledWith('Failed to load user session');
    expect(result.current.loading).toBe(false);
    expect(result.current.profile).toBeNull();
  });

  it('reports a getUser error', async () => {
    setup({}, { getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'jwt expired' } }) });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(setError).toHaveBeenLastCalledWith('Failed to load user session');
  });

  it('reports a missing profile row', async () => {
    tables.user_profiles = [];
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(setError).toHaveBeenLastCalledWith('Failed to load profile');
    expect(result.current.profile).toBeNull();
  });

  it('reports a profile query error', async () => {
    setup({ failures: { select: { user_profiles: 'x' } } });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(setError).toHaveBeenLastCalledWith('Failed to load profile');
  });

  it('keeps the profile but leaves logs empty if the logs query fails', async () => {
    setup({ failures: { select: { user_activity_logs: 'x' } } });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(result.current.profile?.user_id).toBe('u1');
    expect(result.current.activityLogs).toEqual([]);
    expect(setError).toHaveBeenCalledTimes(1); // only the initial clear
  });

  it('sanitizes thrown errors', async () => {
    setup({}, { getUser: () => Promise.reject(new Error('relation "x" does not exist')) });
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(result.current.loading).toBe(false);
  });
});

describe('useUserProfile – updateProfile / handleSaveProfile', () => {
  it('updateProfile is a no-op before a profile is loaded', () => {
    const { result } = render();
    act(() => result.current.updateProfile('full_name', 'X'));
    expect(result.current.profile).toBeNull();
  });

  it('handleSaveProfile is a no-op before a profile is loaded', async () => {
    const { result } = render();
    await act(async () => { await result.current.handleSaveProfile(); });
    expect(fake.writes).toEqual([]);
    expect(setError).not.toHaveBeenCalled();
  });

  it('saves editable fields for the current user only and logs activity', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    act(() => result.current.updateProfile('full_name', 'New Name'));
    act(() => result.current.updateProfile('monthly_reports', false));
    expect(result.current.profile?.full_name).toBe('New Name');
    await act(async () => { await result.current.handleSaveProfile(); });

    const update = fake.writes.find((w) => w.op === 'update');
    expect(update).toMatchObject({ table: 'user_profiles', matched: 1 });
    const values = (update as { values: Record<string, unknown> }).values;
    expect(values).toMatchObject({ full_name: 'New Name', monthly_reports: false, theme: 'dark' });
    // privileged columns are never written from the profile form
    expect(values).not.toHaveProperty('role');
    expect(values).not.toHaveProperty('permissions');
    expect(values).not.toHaveProperty('email');
    expect(tables.user_profiles.find((r) => r.user_id === 'u2')?.full_name).toBe('Other');

    expect(fake.writes).toContainEqual(expect.objectContaining({ op: 'insert', table: 'user_activity_logs' }));
    expect(result.current.activityLogs[0]).toMatchObject({ activity_type: 'profile_update', user_id: 'u1' });
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.saving).toBe(false);
  });

  it('reports an update failure', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    fake.failures.write = { user_profiles: 'violates check constraint' };
    await act(async () => { await result.current.handleSaveProfile(); });
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(setSaveSuccess).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('reports lost authentication during save', async () => {
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    h.client = { ...h.client, auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) } };
    await act(async () => { await result.current.handleSaveProfile(); });
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(fake.writes).toEqual([]);
  });
});

describe('useUserProfile – logActivity', () => {
  it('prepends inserted logs and caps the list at 50', async () => {
    tables.user_activity_logs = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, user_id: 'u1', created_at: `2024-01-${String(i % 28 + 1).padStart(2, '0')}` }));
    const { result } = render();
    await act(async () => { await result.current.loadUserData(); });
    expect(result.current.activityLogs).toHaveLength(50);
    await act(async () => { await result.current.logActivity('t', 'desc'); });
    expect(result.current.activityLogs).toHaveLength(50);
    expect(result.current.activityLogs[0]).toMatchObject({ activity_type: 't', activity_description: 'desc', ip_address: '' });
  });

  it('does nothing when signed out', async () => {
    setup({ signedOut: true });
    const { result } = render();
    await act(async () => { await result.current.logActivity('t', 'd'); });
    expect(fake.writes).toEqual([]);
  });

  it('swallows insert errors and thrown errors', async () => {
    setup({ failures: { write: { user_activity_logs: 'nope' } } });
    const { result } = render();
    await act(async () => { await result.current.logActivity('t', 'd'); });
    expect(result.current.activityLogs).toEqual([]);
    setup({}, { getUser: () => Promise.reject(new Error('x')) });
    await act(async () => { await result.current.logActivity('t', 'd'); });
    expect(setError).not.toHaveBeenCalled();
  });
});

describe('useUserProfile – handlePasswordChange', () => {
  async function change(cur: string, next: string, confirm: string) {
    const hook = render();
    act(() => {
      hook.result.current.setPasswordModal(true);
      hook.result.current.setCurrentPassword(cur);
      hook.result.current.setNewPassword(next);
      hook.result.current.setConfirmPassword(confirm);
    });
    await act(async () => { await hook.result.current.handlePasswordChange('cap-tok'); });
    return hook;
  }
  const LONG = 'a-long-new-password';

  it.each([
    // NOTE: 'Please enter ...' and 'Passwords do not match' are not on the errors.ts safe-message
    // allowlist, so getErrorMessage replaces them with the generic banner (UX bug, see report).
    ['', LONG, LONG, GENERIC],
    ['old', '', '', GENERIC],
    ['old', 'short', 'short', 'Password must be at least 12 characters'],
    ['old', LONG, LONG + 'x', GENERIC],
  ])('validates (cur=%s new=%s)', async (cur, next, confirm, expected) => {
    await change(cur, next, confirm);
    expect(setError).toHaveBeenLastCalledWith(expected);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('verifies the current password then updates', async () => {
    const { result } = await change('old-pass', LONG, LONG);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'me@acme.test', password: 'old-pass', options: { captchaToken: 'cap-tok' } });
    expect(updateUser).toHaveBeenCalledWith({ password: LONG });
    expect(setSaveSuccess).toHaveBeenCalledWith(true);
    expect(result.current.passwordModal).toBe(false);
    expect(result.current.newPassword).toBe('');
    expect(result.current.confirmPassword).toBe('');
    expect(result.current.currentPassword).toBe('');
    expect(result.current.saving).toBe(false);
    expect(result.current.activityLogs[0]).toMatchObject({ activity_type: 'password_change' });
  });

  it('rejects an incorrect current password', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    const { result } = await change('wrong', LONG, LONG);
    expect(updateUser).not.toHaveBeenCalled();
    // 'Current password is incorrect' is also sanitized to the generic message.
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
    expect(result.current.passwordModal).toBe(true);
  });

  it('shows the security-check message when captcha verification fails', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'captcha verification process failed' } });
    await change('old-pass', LONG, LONG);
    expect(updateUser).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Please complete the security check and try again.');
  });

  it('fails when the user has no email', async () => {
    setup({ signedOut: true });
    await change('old', LONG, LONG);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(GENERIC);
  });

  it('reports an updateUser failure', async () => {
    updateUser.mockResolvedValue({ data: {}, error: { message: 'New password should be different from the old password.' } });
    const { result } = await change('old', LONG, LONG);
    expect(setSaveSuccess).not.toHaveBeenCalled();
    expect(result.current.passwordModal).toBe(true);
  });
});

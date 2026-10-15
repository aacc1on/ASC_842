import { describe, it, expect } from 'vitest';

// These tests verify the security controls in the edge function source code
// and the frontend hook behavior changes. We test the source files directly
// to avoid needing a full React test harness.

import * as fs from 'fs';
import * as path from 'path';

describe('SEC-023: Remove user edge function exists and has correct controls', () => {
  const fnPath = path.resolve(__dirname, '../../supabase/functions/remove-user/index.ts');
  const source = fs.readFileSync(fnPath, 'utf8');

  it('verifies caller JWT and requires admin role', () => {
    expect(source).toContain('auth.getUser(token)');
    expect(source).toContain('role !== "admin"');
  });

  it('refuses to remove yourself', () => {
    expect(source).toContain('targetUserId === user.id');
    expect(source).toContain('cannot remove yourself');
  });

  it('refuses to remove the last admin', () => {
    expect(source).toContain('last admin');
    expect(source).toContain('adminCount');
  });

  it('deletes the auth user with admin.deleteUser', () => {
    expect(source).toContain('auth.admin.deleteUser(targetUserId)');
  });

  it('deletes the user_profiles row', () => {
    expect(source).toContain('user_profiles');
    expect(source).toContain('delete()');
  });

  it('writes an audit_log entry', () => {
    expect(source).toContain('audit_log');
    expect(source).toContain('insert');
  });

  it('returns generic error messages', () => {
    expect(source).toContain('An unexpected error occurred');
    expect(source).toMatch(/console\.error/);
  });

  it('checks target is in same organization', () => {
    expect(source).toContain('organization_id !== callerOrgId');
  });
});

describe('SEC-023: Self-insert profile policy is dropped in migration', () => {
  const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationDir);
  const sec023File = files.find(f => f.includes('sec023_020_010_011'));

  it('migration file exists', () => {
    expect(sec023File).toBeDefined();
  });

  it('drops the self-insert profile policy', () => {
    if (!sec023File) return;
    const content = fs.readFileSync(path.join(migrationDir, sec023File), 'utf8');
    expect(content).toContain('DROP POLICY IF EXISTS "Users can insert own profile"');
  });

  it('tightens tenant isolation to remove OR user_id = auth.uid()', () => {
    if (!sec023File) return;
    const content = fs.readFileSync(path.join(migrationDir, sec023File), 'utf8');
    // Check the actual CREATE POLICY statement, not comments
    const policyMatch = content.match(/CREATE POLICY "tenant_isolation_user_profiles"[\s\S]*?WITH CHECK \([^)]*\)/);
    expect(policyMatch).toBeTruthy();
    const policySql = policyMatch![0];
    expect(policySql).not.toContain('user_id = auth.uid()');
    expect(policySql).not.toContain('auth.uid() AS uid');
  });
});

describe('SEC-020/003: useManagedUsers validates 12-char password minimum', () => {
  const hookPath = path.resolve(__dirname, '../hooks/useManagedUsers.ts');
  const source = fs.readFileSync(hookPath, 'utf8');

  it('add user form requires 12-char password', () => {
    expect(source).toContain('password.length < 12');
    expect(source).toContain('Password must be at least 12 characters');
  });

  it('edit user form requires 12-char password', () => {
    // There should be two occurrences of the 12-char check
    const matches = source.match(/password\.length < 12/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('handleDeleteUser calls the remove-user edge function', () => {
    expect(source).toContain('/functions/v1/remove-user');
    expect(source).toContain('targetUserId');
  });

  it('does NOT directly delete from user_profiles in handleDeleteUser', () => {
    // The old code did: supabase.from('user_profiles').delete().eq('user_id', ...)
    // The new code should call the edge function instead
    // Find the actual function implementation (not the interface declaration)
    const implMatch = source.match(/const handleDeleteUser = useCallback[\s\S]*?\}, \[[^\]]*\]\);/);
    expect(implMatch).toBeTruthy();
    const deleteSection = implMatch![0];
    expect(deleteSection).not.toContain("from('user_profiles')");
    expect(deleteSection).not.toContain('.delete()');
  });
});

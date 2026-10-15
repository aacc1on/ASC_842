import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SEC-010: Verify that write policy SQL files do not contain
 * the `OR auth.uid() = user_id` owner branch that lets view users write.
 * This test reads the migration SQL files on disk to verify the pattern
 * was removed. The actual enforcement is in the live database policies.
 */

describe('SEC-010: View role cannot write to business tables', () => {
  it('the access control migration removes the owner branch from write policies', () => {
    const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationDir);
    const sec010File = files.find(f => f.includes('sec023_020_010_011'));
    expect(sec010File).toBeDefined();

    const content = fs.readFileSync(path.join(migrationDir, sec010File!), 'utf8');

    // The migration should drop old policies with the owner branch
    expect(content).toContain('DROP POLICY IF EXISTS "consolidated_insert_leases"');
    expect(content).toContain('DROP POLICY IF EXISTS "consolidated_update_leases"');
    expect(content).toContain('DROP POLICY IF EXISTS "consolidated_delete_leases"');

    // New policies should use is_manage_or_admin() WITHOUT the owner branch
    expect(content).toContain('internal.is_manage_or_admin()');
    // Should NOT contain the old owner-branch pattern in new CREATE POLICY statements
    // for business tables (the user_profiles SELECT/UPDATE still has self-branch, which is fine)
    const businessTablePolicySection = content.split('leases: require is_manage_or_admin')[1];
    expect(businessTablePolicySection).toBeDefined();
    expect(businessTablePolicySection).not.toContain('auth.uid() = user_id');
  });

  it('the migration adds has_permission helper for leases write policies', () => {
    const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationDir);
    const sec010File = files.find(f => f.includes('sec023_020_010_011'));
    if (!sec010File) return;

    const content = fs.readFileSync(path.join(migrationDir, sec010File), 'utf8');
    expect(content).toContain("internal.has_permission('create_edit_leases')");
    expect(content).toContain("internal.has_permission('delete_leases')");
  });
});

describe('SEC-023: Self-insert profile policy is dropped', () => {
  it('the migration drops the Users can insert own profile policy', () => {
    const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationDir);
    const sec023File = files.find(f => f.includes('sec023_020_010_011'));
    if (!sec023File) return;

    const content = fs.readFileSync(path.join(migrationDir, sec023File), 'utf8');
    expect(content).toContain('DROP POLICY IF EXISTS "Users can insert own profile"');
    // Check the actual CREATE POLICY statement, not comments
    const policyMatch = content.match(/CREATE POLICY "tenant_isolation_user_profiles"[\s\S]*?WITH CHECK \([^)]*\)/);
    expect(policyMatch).toBeTruthy();
    const policySql = policyMatch![0];
    expect(policySql).not.toContain('user_id = auth.uid()');
    expect(policySql).not.toContain('auth.uid() AS uid');
  });
});

describe('SEC-011: BEFORE INSERT trigger for user_id', () => {
  it('the migration creates set_user_id triggers on business tables', () => {
    const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationDir);
    const sec011File = files.find(f => f.includes('sec023_020_010_011'));
    if (!sec011File) return;

    const content = fs.readFileSync(path.join(migrationDir, sec011File), 'utf8');
    expect(content).toContain('internal.set_user_id()');
    expect(content).toContain('CREATE TRIGGER set_user_id');
    // Should cover key business tables
    expect(content).toContain('leases');
    expect(content).toContain('transactions');
    expect(content).toContain('amortization_schedules');
  });
});

describe('SEC-010: latest internal.is_manage_or_admin definition', () => {
  it('allows only admin/manage roles and never view', () => {
    const migrationDir = path.resolve(__dirname, '../../supabase/migrations');
    const defRe = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+internal\.is_manage_or_admin\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/i;
    const latest = fs.readdirSync(migrationDir)
      .sort()
      .reverse()
      .map(f => fs.readFileSync(path.join(migrationDir, f), 'utf8').match(defRe))
      .find(Boolean);
    expect(latest).toBeTruthy();
    const body = latest![1];
    const roleList = body.match(/role\s+IN\s*\(([^)]*)\)/i);
    expect(roleList).toBeTruthy();
    const roles = roleList![1].split(',').map(r => r.trim().replace(/'/g, '')).sort();
    expect(roles).toEqual(['admin', 'manage']);
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/organization_id\s*=\s*internal\.current_org_id\(\)/);
  });
});

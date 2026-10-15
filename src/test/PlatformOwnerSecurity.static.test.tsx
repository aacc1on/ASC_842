import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');
const functionsDir = path.resolve(__dirname, '../../supabase/functions');

function readMigration(nameFragment: string): string {
  const files = fs.readdirSync(migrationsDir);
  const file = files.find((f) => f.includes(nameFragment));
  if (!file) throw new Error(`migration containing "${nameFragment}" not found`);
  return fs.readFileSync(path.join(migrationsDir, file), 'utf8');
}

function readFunction(slug: string): string {
  return fs.readFileSync(path.join(functionsDir, slug, 'index.ts'), 'utf8');
}

describe('Platform-owner allow-list (security fix for versions 100-103)', () => {
  const migration = readMigration('secure_platform_owner_and_trial_admin_approval');

  it('creates internal.platform_admins that clients cannot write to', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS internal.platform_admins');
    expect(migration).toContain('ALTER TABLE internal.platform_admins ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON internal.platform_admins FROM anon, authenticated');
  });

  it('seeds only the platform owner (minas.sahakyan@yahoo.com user id)', () => {
    expect(migration).toContain('768308c8-0b63-4f1a-aed1-d7deeb00aa31');
    expect(migration).toMatch(/INSERT INTO internal\.platform_admins/);
  });

  it('exposes is_platform_admin() to authenticated but not anon', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION internal.is_platform_admin()');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.is_platform_admin()');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION internal\.is_platform_admin\(\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION internal\.is_platform_admin\(\) TO authenticated/);
  });
});

describe('get_all_users_with_plans is gated by platform owner, not org admin', () => {
  const restrictMigration = readMigration('restrict_platform_admin_surfaces');

  it('checks internal.is_platform_admin() before returning rows', () => {
    expect(restrictMigration).toContain('internal.is_platform_admin()');
    expect(restrictMigration).toMatch(/RAISE EXCEPTION/i);
  });
});

describe('platform-admin edge functions use is_platform_admin_for_user, not role', () => {
  it('platform-admin-delete-user rejects non-platform-admin callers', () => {
    const src = readFunction('platform-admin-delete-user');
    expect(src).toContain('is_platform_admin_for_user');
    expect(src).toContain('NOT_PLATFORM_ADMIN');
    expect(src).not.toMatch(/callerProfile\.role\s*!==\s*["']admin["']/);
  });

  it('platform-admin-delete-user explains when the user still owns leases or billing records', () => {
    const src = readFunction('platform-admin-delete-user');
    expect(src).toContain('HAS_OWNED_RECORDS');
    expect(src.indexOf('HAS_OWNED_RECORDS')).toBeLessThan(src.indexOf('auth.admin.deleteUser'));
  });

  it('platform-admin-delete-user refuses users whose company has posted months before deleting', () => {
    const src = readFunction('platform-admin-delete-user');
    expect(src).toContain('HAS_POSTED_MONTHS');
    expect(src).toContain('Use the platform-owner deletion with confirmation.');
    expect(src.indexOf('HAS_POSTED_MONTHS')).toBeLessThan(src.indexOf('auth.admin.deleteUser'));
  });

  it('platform-admin-edit-user rejects non-platform-admin callers', () => {
    const src = readFunction('platform-admin-edit-user');
    expect(src).toContain('is_platform_admin_for_user');
    expect(src).toContain('NOT_PLATFORM_ADMIN');
    expect(src).not.toMatch(/callerProfile\.role\s*!==\s*["']admin["']/);
  });
});

describe('subscription RESTRICTIVE policies bypass only the platform owner', () => {
  const removeMigration = readMigration('remove_org_admin_subscription_bypass');

  it('accounting_policy_elections subscription policies use is_platform_admin, not is_admin', () => {
    expect(removeMigration).toContain('internal.is_platform_admin()');
    expect(removeMigration).toContain('accounting_policy_elections');
    expect(removeMigration).not.toMatch(/internal\.is_admin\(\)\s*OR/);
  });
});

describe('trial admin self-approval in enforce_policy_election_rules', () => {
  const migration = readMigration('secure_platform_owner_and_trial_admin_approval');

  it('adds a trial-admin self-approval branch', () => {
    expect(migration).toContain('v_is_trial_admin');
    expect(migration).toContain("org_plan_key");
    expect(migration).toContain("'trial'");
  });

  it('writes the Self-approved (trial, admin) audit log entry', () => {
    expect(migration).toContain('Self-approved (trial, admin)');
  });

  it('uses the row organization_id for the org lookup, not auth.uid()', () => {
    expect(migration).toMatch(/org_plan_key\(\s*v_org_id\s*\)/);
  });
});

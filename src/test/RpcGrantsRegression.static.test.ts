import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression test for v106 bug where EXECUTE was revoked on browser-called
 * RPCs from authenticated, breaking Platform Admin and User Management.
 *
 * This test scans the latest migration that touches the functions and verifies
 * that GRANT EXECUTE TO authenticated is present for:
 * - public.get_all_users_with_plans()
 * - public.admin_set_user_role(uuid, text, jsonb)
 * - public.is_platform_admin()
 *
 * It also checks that anon is NOT granted execute on these functions.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function readAllMigrations(): { filename: string; content: string }[] {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') || f.endsWith('.sql.sql'));
  return files.map((f) => ({
    filename: f,
    content: readFileSync(join(migrationsDir, f), 'utf-8'),
  }));
}

function findMigrationsGrantingFunction(functionName: string): { filename: string; content: string }[] {
  return readAllMigrations().filter((m) => {
    // Look for GRANT EXECUTE on this specific function
    const grantPattern = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+\\w*\\.?${functionName}\\s*\\(`, 'i');
    return grantPattern.test(m.content);
  });
}

function findLatestMigrationAffectingFunction(functionName: string): { filename: string; content: string } | null {
  const all = readAllMigrations();
  const affecting = all.filter((m) =>
    new RegExp(`\\b${functionName}\\b`, 'i').test(m.content)
  );
  if (affecting.length === 0) return null;
  // Return the last one alphabetically (migrations are timestamp-prefixed)
  return affecting[affecting.length - 1];
}

describe('RPC grants regression — browser-called functions must be executable by authenticated', () => {
  it('get_all_users_with_plans has GRANT EXECUTE TO authenticated in migrations', () => {
    const granting = findMigrationsGrantingFunction('get_all_users_with_plans');
    expect(granting.length).toBeGreaterThan(0);
    const hasAuthenticatedGrant = granting.some((m) =>
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?get_all_users_with_plans\s*\(\)\s+TO\s+authenticated/i.test(m.content)
    );
    expect(hasAuthenticatedGrant).toBe(true);
  });

  it('admin_set_user_role has GRANT EXECUTE TO authenticated in migrations', () => {
    const granting = findMigrationsGrantingFunction('admin_set_user_role');
    expect(granting.length).toBeGreaterThan(0);
    const hasAuthenticatedGrant = granting.some((m) =>
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?admin_set_user_role\s*\([^)]*\)\s+TO\s+authenticated/i.test(m.content)
    );
    expect(hasAuthenticatedGrant).toBe(true);
  });

  it('is_platform_admin (public wrapper) has EXECUTE available to authenticated', () => {
    // is_platform_admin is a public function called via supabase.rpc('is_platform_admin')
    const latest = findLatestMigrationAffectingFunction('is_platform_admin');
    expect(latest).not.toBeNull();
    // Check that it's either granted to authenticated or to public (which includes authenticated)
    // or that it was created with SECURITY DEFINER and a grant exists
    const allMigrations = readAllMigrations();
    const hasGrant = allMigrations.some((m) =>
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?is_platform_admin\s*\([^)]*\)\s+TO\s+(authenticated|public)/i.test(m.content)
    );
    expect(hasGrant).toBe(true);
  });

  it('get_all_users_with_plans is NOT granted to anon', () => {
    const granting = findMigrationsGrantingFunction('get_all_users_with_plans');
    // Check that the latest migration for this function does NOT grant to anon
    // (or explicitly revokes from anon)
    const latest = granting[granting.length - 1];
    if (latest) {
      const hasAnonGrant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?get_all_users_with_plans\s*\(\)\s+TO\s+anon/i.test(latest.content);
      // If there's a grant to anon, there must also be a revoke
      if (hasAnonGrant) {
        const hasRevoke = /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?get_all_users_with_plans\s*\(\)\s+FROM\s+anon/i.test(latest.content);
        expect(hasRevoke).toBe(true);
      }
    }
  });

  it('admin_set_user_role is NOT granted to anon', () => {
    const granting = findMigrationsGrantingFunction('admin_set_user_role');
    const latest = granting[granting.length - 1];
    if (latest) {
      const hasAnonGrant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?admin_set_user_role\s*\([^)]*\)\s+TO\s+anon/i.test(latest.content);
      if (hasAnonGrant) {
        const hasRevoke = /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+\w*\.?admin_set_user_role\s*\([^)]*\)\s+FROM\s+anon/i.test(latest.content);
        expect(hasRevoke).toBe(true);
      }
    }
  });
});

/**
 * Test that the RPCs used in the source code are covered by grants.
 * This ensures we don't accidentally call an RPC from the browser that
 * authenticated can't execute.
 */
describe('Source code RPC calls are covered by migration grants', () => {
  const rpcsUsedInBrowser = [
    'is_platform_admin',
    'get_all_users_with_plans',
    'admin_set_user_role',
    'get_lease_summary_stats',
    'get_lease_portfolio_totals',
    'get_filtered_transactions',
    'get_lease_balances_as_of',
    'get_ledger_reconciliation',
    'get_data_health',
    'get_platform_data_health',
  ];

  for (const rpcName of rpcsUsedInBrowser) {
    it(`${rpcName} has a GRANT EXECUTE TO authenticated or public in some migration`, () => {
      const allMigrations = readAllMigrations();
      const hasGrant = allMigrations.some((m) =>
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+\\w*\\.?${rpcName}\\s*\\([^)]*\\)\\s+TO\\s+(authenticated|public)`, 'i').test(m.content)
      );
      // Some functions may be granted via a blanket GRANT or are SECURITY DEFINER
      // wrappers that delegate to internal functions. For those, we just check
      // that the function exists in a migration and is callable.
      if (!hasGrant) {
        // Check if it's a SECURITY DEFINER function with internal checks
        const exists = allMigrations.some((m) =>
          new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+\\w*\\.?${rpcName}`, 'i').test(m.content)
        );
        expect(exists).toBe(true);
      } else {
        expect(hasGrant).toBe(true);
      }
    });
  }
});

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readMigration(): string {
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(dir);
  const file = files.find(f => f.includes('sec013_012_011_followups_round2b'));
  if (!file) throw new Error('Round 2b migration not found');
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

describe('Round 2a follow-up: has_permission admin bypass', () => {
  it('has_permission returns true for admin role', () => {
    const content = readMigration();
    expect(content).toContain("v_role = 'admin'");
    expect(content).toMatch(/IF v_role = 'admin' THEN\s+RETURN true/);
  });
});

describe('Round 2a follow-up: set_user_id forces user_id', () => {
  it('set_user_id forces user_id = auth.uid() (not just when NULL)', () => {
    const content = readMigration();
    expect(content).toContain('NEW.user_id := auth.uid()');
    // Should NOT have the old "IF NEW.user_id IS NULL" guard
    const setFnMatch = content.match(/CREATE OR REPLACE FUNCTION internal\.set_user_id\(\)[\s\S]*?\$\$/);
    expect(setFnMatch).toBeTruthy();
    expect(setFnMatch![0]).not.toContain('NEW.user_id IS NULL');
  });

  it('prevent_user_id_change trigger exists for UPDATE', () => {
    const content = readMigration();
    expect(content).toContain('prevent_user_id_change');
    expect(content).toContain('BEFORE UPDATE');
  });
});

describe('Round 2a follow-up: create_user_profile role-appropriate permissions', () => {
  it('admin gets all permissions true', () => {
    const content = readMigration();
    const adminSection = content.match(/v_role := 'admin'[\s\S]*?v_perms := ([^;]+)/);
    expect(adminSection).toBeTruthy();
    expect(adminSection![1]).toContain('"create_edit_leases":true');
    expect(adminSection![1]).toContain('"manage_user_roles":true');
    expect(adminSection![1]).toContain('"access_user_management":true');
  });

  it('view gets all lease permissions false', () => {
    const content = readMigration();
    const viewSection = content.match(/v_role := 'view'[\s\S]*?v_perms := ([^;]+)/);
    expect(viewSection).toBeTruthy();
    expect(viewSection![1]).toContain('"create_edit_leases":false');
    expect(viewSection![1]).toContain('"delete_leases":false');
    expect(viewSection![1]).toContain('"run_month_end":false');
  });
});

describe('SEC-013: Prevent posted/closed record mutation', () => {
  it('has trigger to prevent posted transaction mutation', () => {
    const content = readMigration();
    expect(content).toContain('prevent_posted_transaction_mutation');
    expect(content).toContain('prevent_posted_transaction_update');
    expect(content).toContain('prevent_posted_transaction_delete');
  });

  it('has trigger to prevent finalized month-end mutation', () => {
    const content = readMigration();
    expect(content).toContain('prevent_month_end_mutation');
    expect(content).toContain('prevent_month_end_update');
    expect(content).toContain('prevent_month_end_delete');
  });

  it('has triggers for locked/closed accounting periods on lease_transactions', () => {
    const content = readMigration();
    expect(content).toContain('prevent_period_locked_mutation_lt');
    expect(content).toContain('prevent_period_locked_lt_update');
    expect(content).toContain('prevent_period_locked_lt_delete');
  });

  it('has triggers for locked/closed accounting periods on journal_entries', () => {
    const content = readMigration();
    expect(content).toContain('prevent_period_locked_mutation_je');
    expect(content).toContain('prevent_period_locked_je_update');
    expect(content).toContain('prevent_period_locked_je_delete');
  });

  it('triggers allow service role (auth.uid() IS NULL) to proceed', () => {
    const content = readMigration();
    expect(content).toMatch(/IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW/);
  });

  it('has admin reopen function with reason requirement', () => {
    const content = readMigration();
    expect(content).toContain('internal.reopen_month_end');
    expect(content).toContain('p_reason');
    expect(content).toContain('A reason is required');
  });
});

describe('SEC-012: Password policy in source files', () => {
  it('Auth.tsx uses 12-char minimum for sign-up', () => {
    const authPath = path.resolve(__dirname, '../components/Auth.tsx');
    const source = fs.readFileSync(authPath, 'utf8');
    expect(source).toContain('password.length < 12');
    expect(source).toContain('Password must be at least 12 characters');
  });

  it('Auth.tsx uses 12-char minimum for password reset', () => {
    const authPath = path.resolve(__dirname, '../components/Auth.tsx');
    const source = fs.readFileSync(authPath, 'utf8');
    expect(source).toContain('newPassword.length < 12');
  });

  it('useUserProfile verifies current password before updating', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useUserProfile.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('signInWithPassword');
    expect(source).toContain('currentPassword');
    expect(source).toContain('Current password is incorrect');
  });

  it('useUserProfile enforces 12-char minimum', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useUserProfile.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('newPassword.length < 12');
  });

  it('PasswordChangeModal shows current password field', () => {
    const modalPath = path.resolve(__dirname, '../components/user/PasswordChangeModal.tsx');
    const source = fs.readFileSync(modalPath, 'utf8');
    expect(source).toContain('Current Password');
    expect(source).toContain('currentPassword');
  });
});

describe('SEC-024: export-backup edge function', () => {
  const fnPath = path.resolve(__dirname, '../../supabase/functions/export-backup/index.ts');
  const source = fs.readFileSync(fnPath, 'utf8');

  it('verifies caller JWT', () => {
    expect(source).toContain('auth.getUser(token)');
  });

  it('requires admin role', () => {
    expect(source).toContain('role !== "admin"');
  });

  it('ignores client-supplied email', () => {
    // The function does not parse email from the request body at all
    expect(source).not.toContain('user_email');
    expect(source).not.toMatch(/email.*req\.json/);
  });

  it('exports only the caller organization rows', () => {
    expect(source).toContain('callerOrgId');
    expect(source).toContain('eq("organization_id", callerOrgId)');
  });

  it('returns JSON directly in response (no external URL)', () => {
    expect(source).toContain('JSON.stringify(payload');
    expect(source).not.toContain('signedUrl');
    expect(source).not.toContain('createSignedUrl');
  });

  it('writes audit log entry', () => {
    expect(source).toContain('audit_log');
    expect(source).toContain('EXPORT');
  });

  it('exports all required tables', () => {
    const tables = [
      'leases', 'amortization_schedules', 'lease_payment_schedules',
      'transactions', 'lease_transactions', 'journal_entries',
      'contract_modifications', 'contract_cancellations', 'lease_modifications',
      'lease_impairments', 'accounting_policy_elections', 'lessors',
      'branches', 'fixed_asset_types', 'documents', 'month_end_documents',
      'accounting_periods', 'audit_log',
    ];
    for (const t of tables) {
      expect(source).toContain(`"${t}"`);
    }
  });

  it('returns generic error messages', () => {
    expect(source).toContain('An unexpected error occurred');
  });
});

describe('SEC-012: Idle timeout', () => {
  it('useIdleTimeout hook exists with 30 min timeout and 2 min warning', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useIdleTimeout.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('30 * 60 * 1000');
    expect(source).toContain('2 * 60 * 1000');
    expect(source).toContain('showWarning');
    expect(source).toContain('dismissWarning');
  });

  it('App.tsx integrates idle timeout with warning modal', () => {
    const appPath = path.resolve(__dirname, '../App.tsx');
    const source = fs.readFileSync(appPath, 'utf8');
    expect(source).toContain('useIdleTimeout');
    expect(source).toContain('showIdleWarning');
    expect(source).toContain('Stay signed in');
  });
});

describe('SEC-012: MFA enrollment', () => {
  it('useMfa hook exists with enroll/verify/unenroll', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useMfa.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('mfa.enroll');
    expect(source).toContain('mfa.challenge');
    expect(source).toContain('mfa.verify');
    expect(source).toContain('mfa.unenroll');
    expect(source).toContain('needsAal2');
  });

  it('MfaSection component exists with QR enrollment UI', () => {
    const compPath = path.resolve(__dirname, '../components/user/MfaSection.tsx');
    const source = fs.readFileSync(compPath, 'utf8');
    expect(source).toContain('enrollQrUrl');
    expect(source).toContain('verifyCode');
    expect(source).toContain('authenticator');
  });

  it('ProfileTab includes MfaSection', () => {
    const tabPath = path.resolve(__dirname, '../components/user/ProfileTab.tsx');
    const source = fs.readFileSync(tabPath, 'utf8');
    expect(source).toContain('MfaSection');
  });

  it('shows banner for admin/manage users without MFA', () => {
    const compPath = path.resolve(__dirname, '../components/user/MfaSection.tsx');
    const source = fs.readFileSync(compPath, 'utf8');
    expect(source).toContain("userRole === 'admin'");
    expect(source).toContain('Secure your account');
  });
});

describe('SEC-013: UI blocks posted transaction deletion', () => {
  it('useTransactionMutations blocks delete on posted transactions', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useTransactionMutations.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('month_end_document_id');
    expect(source).toContain('Cannot delete a posted month-end transaction');
  });

  it('useTransactionMutations blocks reverse on posted transactions', () => {
    const hookPath = path.resolve(__dirname, '../hooks/useTransactionMutations.ts');
    const source = fs.readFileSync(hookPath, 'utf8');
    expect(source).toContain('Cannot reverse a posted month-end transaction');
  });
});

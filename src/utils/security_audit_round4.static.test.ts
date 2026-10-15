import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toUserMessage, getRawErrorMessage } from './errors';

const projectRoot = join(__dirname, '..', '..');

describe('F7: internal error detail is never rendered', () => {
  it('replaces policy and constraint detail with a generic message', () => {
    const internal = [
      'new row violates row-level security policy for table "lessors"',
      'duplicate key value violates unique constraint "lessors_name_key"',
      'relation "public.secret" does not exist',
      'permission denied for table user_profiles',
      'null value in column "amount" violates not-null constraint',
    ];
    for (const message of internal) {
      const shown = toUserMessage({ code: '42501', message });
      expect(shown).not.toContain('policy');
      expect(shown).not.toContain('constraint');
      expect(shown).not.toContain('permission denied');
      expect(shown).not.toContain('relation');
    }
  });

  it('toUserMessage returns a non-empty string for a known error object', () => {
    const result = toUserMessage({ code: '42501', message: 'permission denied for table leases' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('toUserMessage returns a non-empty string for a plain Error', () => {
    const result = toUserMessage(new Error('network failure'));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('getRawErrorMessage returns the raw message from an Error object', () => {
    expect(getRawErrorMessage(new Error('internal detail'))).toBe('internal detail');
  });

  it('getRawErrorMessage returns a string for a Supabase-style error object', () => {
    const raw = getRawErrorMessage({ code: '42501', message: 'permission denied' });
    expect(typeof raw).toBe('string');
    expect(raw).toContain('permission denied');
  });

  it('keeps the unfiltered message available for logging only', () => {
    expect(getRawErrorMessage(new Error('internal detail'))).toBe('internal detail');
  });

  it('hooks no longer pass raw error.message into the interface', () => {
    const files = [
      join('src', 'hooks', 'useTransactionMutations.ts'),
      join('src', 'hooks', 'useModificationActions.ts'),
      join('src', 'hooks', 'useContractModActions.ts'),
      join('src', 'hooks', 'useImpairmentActions.ts'),
      join('src', 'hooks', 'usePolicyElections.ts'),
      join('src', 'hooks', 'useMonthEnd.ts'),
      join('src', 'hooks', 'useLessors.ts'),
      join('src', 'hooks', 'useAuditLog.ts'),
      join('src', 'hooks', 'useErrorLog.ts'),
    ];
    for (const file of files) {
      const content = readFileSync(join(projectRoot, file), 'utf-8');
      expect(content).toContain('toUserMessage');
      expect(content).not.toMatch(/set(Error|ErrorMessage)\(\w+\.message\)/);
      expect(content).not.toMatch(/\w+ instanceof Error \? \w+\.message :/);
    }
  });
});

describe('F8: signup does not reveal existing accounts', () => {
  it('uses one neutral message for both the new and existing account outcomes', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'Auth.tsx'), 'utf-8');
    expect(content).toContain('SIGNUP_NEUTRAL_MESSAGE');
    expect(content).not.toContain('Account created! You are now signed in.');
    expect(content.match(/setSuccess\(SIGNUP_NEUTRAL_MESSAGE\)/g)?.length).toBe(2);
  });
});

describe('F14: signup password length is consistent', () => {
  it('the signup password input requires 12 characters', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'Auth.tsx'), 'utf-8');
    expect(content).not.toContain('minLength={6}');
    expect(content).toContain('minLength={12}');
  });
});

describe('F6: user creation never touches other organizations', () => {
  it('recreate-user no longer enumerates or deletes other organizations', () => {
    const content = readFileSync(
      join(projectRoot, 'supabase', 'functions', 'recreate-user', 'index.ts'),
      'utf-8',
    );
    expect(content).not.toContain('strayOrgs');
    expect(content).not.toContain('from("organizations").delete()');
    expect(content).not.toContain('.not("id", "eq", callerOrgId)');
  });
});

describe('F13: the stripe webhook claims an event before processing it', () => {
  it('inserts the event id first and releases the claim on failure', () => {
    const content = readFileSync(
      join(projectRoot, 'supabase', 'functions', 'stripe-webhook', 'index.ts'),
      'utf-8',
    );
    const claimIndex = content.indexOf("insert({ event_id: event.id");
    const handleIndex = content.indexOf('await handleEvent(event)');
    expect(claimIndex).toBeGreaterThan(-1);
    expect(handleIndex).toBeGreaterThan(claimIndex);
    expect(content).toContain("claimError.code === '23505'");
    expect(content).toContain(".delete().eq('event_id', event.id)");
  });
});

describe('F10: role changes go through the server-side function', () => {
  it('useManagedUsers calls admin_set_user_role instead of writing the columns', () => {
    const content = readFileSync(join(projectRoot, 'src', 'hooks', 'useManagedUsers.ts'), 'utf-8');
    expect(content).toContain("rpc('admin_set_user_role'");
    // No direct column write to role/permissions on user_profiles.
    expect(content).not.toMatch(/\.update\(\{[^}]*\brole\b/);
  });
});

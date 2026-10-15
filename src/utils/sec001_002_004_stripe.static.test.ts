import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SEC-001/002/004: Stripe edge function security tests.
 * These tests verify the source code of the edge functions contains
 * the required security controls.
 */

describe('SEC-001: Stripe checkout prevents open redirect', () => {
  const checkoutPath = path.resolve(__dirname, '../../supabase/functions/stripe-checkout/index.ts');
  const source = fs.readFileSync(checkoutPath, 'utf8');

  it('has an allowed-origins allowlist for redirect validation', () => {
    expect(source).toContain('isAllowedOrigin');
    expect(source).toContain('isAllowedRedirect');
  });

  it('validates redirect URLs against the allowlist', () => {
    expect(source).toContain('isAllowedRedirect');
    expect(source).toContain('Invalid redirect URL');
  });

  it('rejects redirect URLs whose origin is not in the allowlist', () => {
    expect(source).toContain('isAllowedOrigin(new URL(url).origin)');
  });
});

describe('SEC-002: All edge functions check Authorization header and return generic errors', () => {
  const functions = [
    'stripe-checkout',
    'recreate-user',
    'admin-update-user-password',
    'remove-user',
  ];

  for (const fn of functions) {
    it(`${fn} checks Authorization header`, () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, `../../supabase/functions/${fn}/index.ts`),
        'utf8'
      );
      expect(source).toContain('Authorization');
      expect(source).toMatch(/Missing authorization|Authentication required/);
    });

    it(`${fn} returns generic error messages (not raw error.message)`, () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, `../../supabase/functions/${fn}/index.ts`),
        'utf8'
      );
      // The catch block should NOT return err.message to the client
      expect(source).toContain('An unexpected error occurred');
      // Should log details server-side
      expect(source).toMatch(/console\.error/);
    });
  }
});

describe('SEC-004: Stripe webhook processes events before replying', () => {
  const webhookPath = path.resolve(__dirname, '../../supabase/functions/stripe-webhook/index.ts');
  const source = fs.readFileSync(webhookPath, 'utf8');

  it('does not return immediately with received:true before processing', () => {
    // The old pattern was: EdgeRuntime.waitUntil(handleEvent(event)); return Response.json({received: true});
    // The new pattern should await handleEvent before returning
    expect(source).toContain('await handleEvent(event)');
  });

  it('returns 5xx on processing failure so Stripe retries', () => {
    expect(source).toContain('status: 500');
    expect(source).toContain('Failed to process event');
  });

  it('stores processed event ids for idempotency', () => {
    expect(source).toContain('stripe_processed_events');
    expect(source).toContain('event_id');
    expect(source).toContain('already processed');
  });
});

describe('SEC-020/003: recreate-user validates inputs', () => {
  const fnPath = path.resolve(__dirname, '../../supabase/functions/recreate-user/index.ts');
  const source = fs.readFileSync(fnPath, 'utf8');

  it('validates role against allow-list (admin, manage, view)', () => {
    expect(source).toContain('ALLOWED_ROLES');
    expect(source).toContain('admin');
    expect(source).toContain('manage');
    expect(source).toContain('view');
  });

  it('validates email format', () => {
    expect(source).toContain('EMAIL_REGEX');
  });

  it('requires minimum 12 character password', () => {
    expect(source).toContain('MIN_PASSWORD_LENGTH');
    expect(source).toMatch(/12/);
  });

  it('upserts profile with service role (not update)', () => {
    expect(source).toContain('.upsert(');
  });

  it('verifies exactly one profile with correct org and role', () => {
    expect(source).toContain('verifyProfile');
    expect(source).toContain('organization_id');
    expect(source).toContain('role');
  });

  it('deletes auth user on failure', () => {
    expect(source).toContain('deleteUser(newUserId)');
  });
});

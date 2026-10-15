import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = join(__dirname, '..', '..');

describe('billing security: cancel/resume edge function', () => {
  it('never trusts a subscription_id or org_id from the client', () => {
    const fn = readFileSync(
      join(PROJECT, 'supabase', 'functions', 'stripe-manage-subscription', 'index.ts'),
      'utf8',
    );
    // Must resolve the org from the authenticated user's profile, not from the request body.
    expect(fn).toMatch(/user_profiles.*organization_id.*role/s);
    expect(fn).toMatch(/role.*!==.*admin.*403/s);
    // Must NOT accept a subscription_id or org_id from the client.
    expect(fn).not.toMatch(/req\.json\(\).*subscription_id/);
    expect(fn).not.toMatch(/body\.org_id|body\.organization_id/);
  });

  it('rate-limits the manage-subscription function', () => {
    const rl = readFileSync(join(PROJECT, 'supabase', 'functions', '_shared', 'rateLimit.ts'), 'utf8');
    expect(rl).toMatch(/stripe-manage-subscription/);
    expect(rl).toMatch(/stripe-customer-portal/);
  });

  it('config.toml has entries for the new edge functions', () => {
    const cfg = readFileSync(join(PROJECT, 'supabase', 'config.toml'), 'utf8');
    expect(cfg).toMatch(/\[functions\.stripe-manage-subscription\]/);
    expect(cfg).toMatch(/\[functions\.stripe-customer-portal\]/);
  });
});

describe('billing security: webhook invoice recording', () => {
  it('webhook handles invoice.paid, invoice.payment_failed, and invoice.finalized', () => {
    const wh = readFileSync(
      join(PROJECT, 'supabase', 'functions', 'stripe-webhook', 'index.ts'),
      'utf8',
    );
    expect(wh).toMatch(/invoice\.paid/);
    expect(wh).toMatch(/invoice\.payment_failed/);
    expect(wh).toMatch(/invoice\.finalized/);
    expect(wh).toMatch(/stripe_invoices/);
    // Must upsert (idempotent) on stripe_invoice_id.
    expect(wh).toMatch(/onConflict.*stripe_invoice_id/);
  });

  it('webhook handles customer.subscription.updated and deleted', () => {
    const wh = readFileSync(
      join(PROJECT, 'supabase', 'functions', 'stripe-webhook', 'index.ts'),
      'utf8',
    );
    expect(wh).toMatch(/customer\.subscription\.updated/);
    expect(wh).toMatch(/customer\.subscription\.deleted/);
  });

  it('webhook idempotency: claims event before processing and releases on failure', () => {
    const wh = readFileSync(
      join(PROJECT, 'supabase', 'functions', 'stripe-webhook', 'index.ts'),
      'utf8',
    );
    expect(wh).toMatch(/stripe_processed_events[\s\S]*insert[\s\S]*event_id/);
    expect(wh).toMatch(/23505/);
    expect(wh).toMatch(/stripe_processed_events[\s\S]*delete[\s\S]*event_id/);
  });
});

describe('billing security: invoices RLS', () => {
  it('stripe_invoices migration has RLS and org-scoped SELECT policy', () => {
    const migrationsDir = join(PROJECT, 'supabase', 'migrations');
    const files = readdirSync(migrationsDir).filter(f => f.includes('billing_invoices')).sort();
    expect(files.length).toBeGreaterThan(0);
    const sql = files.map(f => readFileSync(join(migrationsDir, f), 'utf8')).join('\n');
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY.*stripe_invoices/s);
    expect(sql).toMatch(/select_org_invoices/);
    expect(sql).toMatch(/internal\.current_org_id|internal\.is_platform_admin/s);
    // No INSERT/UPDATE/DELETE policy for authenticated — only service role writes.
    expect(sql).not.toMatch(/FOR INSERT.*TO authenticated/s);
    expect(sql).not.toMatch(/FOR UPDATE.*TO authenticated/s);
  });
});

describe('billing security: customer portal', () => {
  it('verifies admin role and never trusts client-provided customer_id', () => {
    const fn = readFileSync(
      join(PROJECT, 'supabase', 'functions', 'stripe-customer-portal', 'index.ts'),
      'utf8',
    );
    expect(fn).toMatch(/user_profiles.*organization_id.*role/s);
    expect(fn).toMatch(/role.*!==.*admin.*403/s);
    expect(fn).not.toMatch(/body[^\n]*customer_id|req\.json\(\)[^\n]*customer_id/);
  });
});

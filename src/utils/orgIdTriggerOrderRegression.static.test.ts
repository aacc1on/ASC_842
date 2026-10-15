import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// PostgreSQL fires BEFORE triggers in trigger-name order (byte comparison). The
// trigger that fills organization_id must sort first, otherwise plan/approval
// checks see NULL and reject client inserts that omit organization_id.

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const FIX_MIGRATION = '20261011024747_org_id_default_and_set_org_trigger_first.sql';
const SET_ORG_TRIGGER = 'a00_set_organization_id';

// Verified against the live database: every table with organization_id except
// user_profiles (membership set by signup/admin functions) and subscriptions (billing webhook).
const ORG_SCOPED_TABLES = [
  'accounting_periods', 'accounting_policy_elections', 'amortization_schedules',
  'approval_settings', 'audit_log', 'branches', 'companies', 'contract_cancellations',
  'contract_modifications', 'documents', 'error_logs', 'fixed_asset_types', 'journal_entries',
  'lease_impairments', 'lease_modifications', 'lease_payment_schedules', 'lease_payments',
  'lease_transactions', 'leases', 'lessors', 'month_end_documents', 'stripe_invoices',
  'transactions', 'user_activity_logs',
];
const EXCLUDED_TABLES = ['user_profiles', 'subscriptions'];

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ filename: f, content: readFileSync(join(MIGRATIONS_DIR, f), 'utf-8') }));

function byteCompare(a: string, b: string): number {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return Buffer.compare(ba, bb);
}

function lastFunctionBody(name: string): string | null {
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+internal\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s*(\\$\\w*\\$)([\\s\\S]*?)\\1`,
    'gi',
  );
  let body: string | null = null;
  for (const f of files) {
    for (const m of f.content.matchAll(re)) body = m[2];
  }
  return body;
}

function beforeInsertTriggerNames(): string[] {
  const names = new Set<string>();
  const re = /CREATE\s+TRIGGER\s+"?(\w+)"?\s+BEFORE\s+[\w\s]*INSERT/gi;
  for (const f of files) {
    for (const m of f.content.matchAll(re)) names.add(m[1]);
  }
  return [...names];
}

describe('organization_id is filled before any other BEFORE trigger', () => {
  const fix = files.find((f) => f.filename === FIX_MIGRATION);

  it('fix migration exists', () => {
    expect(fix, `${FIX_MIGRATION} missing`).toBeDefined();
  });

  it('applies a default and the a00 trigger to every organization_id table except the documented exclusions', () => {
    const sql = fix!.content;
    expect(sql).toMatch(/column_name\s*=\s*'organization_id'/);
    expect(sql).toMatch(/ALTER COLUMN organization_id SET DEFAULT internal\.current_org_id\(\)/);
    expect(sql).toMatch(new RegExp(`CREATE TRIGGER ${SET_ORG_TRIGGER} BEFORE INSERT OR UPDATE`));
    const exclusion = sql.match(/table_name NOT IN \(([^)]*)\)/);
    expect(exclusion).not.toBeNull();
    const excluded = [...exclusion![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(excluded).toEqual([...EXCLUDED_TABLES].sort());
    for (const t of ORG_SCOPED_TABLES) expect(EXCLUDED_TABLES).not.toContain(t);
  });

  it(`${SET_ORG_TRIGGER} sorts before every other BEFORE INSERT trigger name`, () => {
    const others = beforeInsertTriggerNames().filter((n) => n !== SET_ORG_TRIGGER);
    expect(others).toContain('aa_approval_workflow');
    expect(others.some((n) => n.startsWith('enforce_plan_feature'))).toBe(true);
    for (const name of others) {
      expect(byteCompare(SET_ORG_TRIGGER, name), `${name} would fire before ${SET_ORG_TRIGGER}`).toBeLessThan(0);
    }
  });

  it('later migrations never drop the default or reattach set_organization_id under another trigger name', () => {
    const later = files.filter((f) => f.filename > FIX_MIGRATION);
    for (const f of later) {
      expect(f.content, f.filename).not.toMatch(/organization_id\s+DROP\s+DEFAULT/i);
      for (const m of f.content.matchAll(/CREATE\s+TRIGGER\s+"?(\w+)"?[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+internal\.set_organization_id/gi)) {
        expect(m[1], f.filename).toBe(SET_ORG_TRIGGER);
      }
    }
  });

  it('tables created later with organization_id also get the default and a00 trigger', () => {
    const later = files.filter((f) => f.filename > FIX_MIGRATION);
    for (const f of later) {
      for (const m of f.content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/gi)) {
        if (!/\borganization_id\b/.test(m[2])) continue;
        const table = m[1];
        const fromHere = later.filter((g) => g.filename >= f.filename).map((g) => g.content).join('\n');
        const inlineDefault = /organization_id[^,]*DEFAULT\s+internal\.current_org_id\(\)/i.test(m[2]);
        const alterDefault = new RegExp(
          `ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ALTER\\s+COLUMN\\s+organization_id\\s+SET\\s+DEFAULT\\s+internal\\.current_org_id\\(\\)`,
          'i',
        ).test(fromHere);
        expect(inlineDefault || alterDefault, `${table} in ${f.filename}: organization_id default`).toBe(true);
        expect(fromHere, `${table} in ${f.filename}`).toMatch(
          new RegExp(`CREATE\\s+TRIGGER\\s+${SET_ORG_TRIGGER}[\\s\\S]*?ON\\s+(?:public\\.)?${table}\\b`, 'i'),
        );
      }
    }
  });

  it('set_organization_id fills from the caller org and keeps organization_id immutable', () => {
    const body = lastFunctionBody('set_organization_id');
    expect(body).not.toBeNull();
    expect(body!).toMatch(/NEW\.organization_id\s*:=\s*COALESCE\(NEW\.organization_id,\s*internal\.current_org_id\(\)\)/);
    expect(body!).toMatch(/organization_id cannot be changed/);
  });

  it('enforce_plan_feature still fails closed with a clear message when the org is unknown', () => {
    const body = lastFunctionBody('enforce_plan_feature');
    expect(body).not.toBeNull();
    expect(body!).toMatch(/IF org_id IS NULL THEN\s*RAISE EXCEPTION 'Could not determine your organization/);
    expect(body!).not.toMatch(/organization_id is required for feature-gated table/);
  });

  it('no duplicate set-org function remains', () => {
    expect(fix!.content).toMatch(/DROP FUNCTION IF EXISTS internal\.set_lessor_org_id\(\)/);
  });
});

describe('PostgreSQL trigger ordering model', () => {
  it('fires a00_set_organization_id first for the live branches/modifications trigger sets', () => {
    const liveSets: Record<string, string[]> = {
      branches: ['enforce_plan_feature_branches', SET_ORG_TRIGGER],
      contract_modifications: ['set_user_id', 'enforce_plan_feature_contract_modifications', 'aa_approval_workflow', SET_ORG_TRIGGER],
      accounting_policy_elections: ['enforce_policy_election_rules', 'aa_approval_workflow', SET_ORG_TRIGGER],
      leases: ['set_user_id', 'enforce_lease_limit', SET_ORG_TRIGGER],
    };
    for (const [table, triggers] of Object.entries(liveSets)) {
      expect([...triggers].sort(byteCompare)[0], table).toBe(SET_ORG_TRIGGER);
    }
  });

  it('the naive "aa_set_organization_id" name would NOT fire first', () => {
    expect(['aa_approval_workflow', 'aa_set_organization_id'].sort(byteCompare)[0]).toBe('aa_approval_workflow');
  });
});

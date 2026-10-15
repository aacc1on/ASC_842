// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

let db: PGlite;
let seq = 0;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await rows<T>(sql, params))[0];
}

async function signUp(): Promise<{ id: string; org: string }> {
  seq += 1;
  const meta = { terms_accepted: true, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };
  const { id } = await one<{ id: string }>(
    'INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id',
    [`golive${seq}@example.com`, JSON.stringify(meta)],
  );
  const { organization_id } = await one<{ organization_id: string }>('SELECT organization_id FROM public.user_profiles WHERE user_id = $1', [id]);
  return { id, org: organization_id };
}

async function addLeaseWithoutSchedule(owner: { id: string; org: string }, name: string) {
  await db.query(
    `INSERT INTO public.leases (user_id, organization_id, lease_name, lessor_name, lease_start_date, lease_end_date,
       lease_term_months, payment_amount, incremental_borrowing_rate, is_complete, accounting_treatment)
     VALUES ($1, $2, $3, 'Lessor', '2026-01-01', '2026-12-31', 12, 1000, 5, true, 'recognized')`,
    [owner.id, owner.org, name],
  );
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [userId]);
  await db.exec('SET ROLE authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  return '';
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(ROOT, 'scripts/supabase-standins.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
}, 120_000);

afterAll(async () => {
  await db.close();
});

afterEach(async () => {
  await db.exec('RESET ROLE');
});

describe('leases_missing_amortization isolation', () => {
  it('only shows the caller organization rows, never another organization', async () => {
    const a = await signUp();
    const b = await signUp();
    await addLeaseWithoutSchedule(a, 'Org A lease');
    await addLeaseWithoutSchedule(b, 'Org B lease');

    const seenByA = await asUser(a.id, () => rows<{ organization_id: string; lease_name: string }>(
      'SELECT organization_id, lease_name FROM public.leases_missing_amortization',
    ));
    expect(seenByA.map((r) => r.lease_name)).toEqual(['Org A lease']);
    expect(seenByA.every((r) => r.organization_id === a.org)).toBe(true);

    const explicitB = await asUser(a.id, () => rows(
      'SELECT 1 FROM public.leases_missing_amortization WHERE organization_id = $1', [b.org],
    ));
    expect(explicitB).toHaveLength(0);
  });

  it('runs as the caller and is read-only', async () => {
    const opts = await one<{ opts: string[] | null }>("SELECT reloptions AS opts FROM pg_class WHERE relname = 'leases_missing_amortization'");
    expect(opts.opts).toContain('security_invoker=true');

    const privs = await one<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; anon: boolean }>(
      `SELECT has_table_privilege('authenticated', 'public.leases_missing_amortization', 'SELECT') AS sel,
              has_table_privilege('authenticated', 'public.leases_missing_amortization', 'INSERT') AS ins,
              has_table_privilege('authenticated', 'public.leases_missing_amortization', 'UPDATE') AS upd,
              has_table_privilege('authenticated', 'public.leases_missing_amortization', 'DELETE') AS del,
              has_table_privilege('anon', 'public.leases_missing_amortization', 'SELECT') AS anon`,
    );
    expect(privs).toEqual({ sel: true, ins: false, upd: false, del: false, anon: false });

    const a = await signUp();
    const err = await asUser(a.id, () => errorOf(db.query('DELETE FROM public.leases_missing_amortization')));
    expect(err).toMatch(/permission denied/);
  });
});

describe('billing views are SELECT-only', () => {
  it.each(['stripe_org_invoices', 'stripe_org_subscriptions'])('%s grants only SELECT to signed-in users', async (view) => {
    const p = await one<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('authenticated', $1, 'SELECT') AS sel,
              has_table_privilege('authenticated', $1, 'INSERT') AS ins,
              has_table_privilege('authenticated', $1, 'UPDATE') AS upd,
              has_table_privilege('authenticated', $1, 'DELETE') AS del`,
      [`public.${view}`],
    );
    expect(p).toEqual({ sel: true, ins: false, upd: false, del: false });
  });
});

describe('lapsed trials', () => {
  it('stores a trial past its end date as expired and keeps access cut off', async () => {
    const a = await signUp();
    await db.query("UPDATE public.subscriptions SET trial_ends_at = now() - interval '1 day' WHERE organization_id = $1", [a.org]);
    const { n } = await one<{ n: number }>('SELECT internal.expire_lapsed_trials() AS n');
    expect(n).toBeGreaterThanOrEqual(1);

    const sub = await one<{ status: string }>('SELECT status FROM public.subscriptions WHERE organization_id = $1', [a.org]);
    expect(sub.status).toBe('expired');
    const plan = await one<{ k: string }>('SELECT internal.org_plan_key($1) AS k', [a.org]);
    expect(plan.k).toBe('expired');
    const my = await asUser(a.id, () => one<{ p: { status: string } }>('SELECT public.get_my_plan() AS p'));
    expect(my.p.status).toBe('expired');
  });

  it('leaves a live trial untouched', async () => {
    const a = await signUp();
    await one('SELECT internal.expire_lapsed_trials()');
    const sub = await one<{ status: string }>('SELECT status FROM public.subscriptions WHERE organization_id = $1', [a.org]);
    expect(sub.status).toBe('trialing');
  });

  it('cannot be run by signed-in users', async () => {
    const a = await signUp();
    const err = await asUser(a.id, () => errorOf(db.query('SELECT internal.expire_lapsed_trials()')));
    expect(err).toMatch(/permission denied/);
  });
});

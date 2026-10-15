// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const OVERRIDE_HINT = 'Use the platform-owner deletion with confirmation.';

let db: PGlite;
let seq = 0;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await rows<T>(sql, params))[0];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: number }>(sql, params)).n);
}

interface Tenant { id: string; org: string; company: string; lease: string }

async function tenantWithPostedMonths(months: string[], companyName = 'MS Consulting'): Promise<Tenant> {
  seq += 1;
  const meta = { terms_accepted: true, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };
  const { id } = await one<{ id: string }>(
    'INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id',
    [`guard${seq}@example.com`, JSON.stringify(meta)],
  );
  const { organization_id: org } = await one<{ organization_id: string }>('SELECT organization_id FROM public.user_profiles WHERE user_id = $1', [id]);
  const { id: company } = await one<{ id: string }>(
    "INSERT INTO public.companies (user_id, organization_id, company_name, company_code) VALUES ($1, $2, $3, '001') RETURNING id",
    [id, org, companyName],
  );
  const { id: lease } = await one<{ id: string }>(
    `INSERT INTO public.leases (user_id, organization_id, company_id, lease_name, lessor_name, lease_start_date, lease_end_date,
       lease_term_months, payment_amount, incremental_borrowing_rate, is_complete, accounting_treatment)
     VALUES ($1, $2, $3, $4, 'Lessor', '2026-01-01', '2026-12-31', 12, 1000, 5, true, 'recognized') RETURNING id`,
    [id, org, company, `Lease ${seq}`],
  );
  for (const period of months) {
    await db.query(
      `INSERT INTO public.accounting_periods (organization_id, user_id, period, period_start, period_end, status)
       VALUES ($1, $2, $3, ($3 || '-01')::date, (($3 || '-01')::date + interval '1 month' - interval '1 day')::date, 'locked')`,
      [org, id, period],
    );
  }
  return { id, org, company, lease };
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
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
});

describe('posted data cannot be deleted by plain DELETE', () => {
  it('blocks a service-level company delete with the posted month count', async () => {
    const t = await tenantWithPostedMonths(['2026-01', '2026-02', '2026-03']);
    const msg = await errorOf(db.query('DELETE FROM public.companies WHERE id = $1', [t.company]));
    expect(msg).toBe(`This company has 3 posted months. ${OVERRIDE_HINT}`);
    expect(await count('SELECT count(*) AS n FROM public.companies WHERE id = $1', [t.company])).toBe(1);
  });

  it('blocks a service-level lease delete when the lease overlaps posted months', async () => {
    const t = await tenantWithPostedMonths(['2026-01']);
    const msg = await errorOf(db.query('DELETE FROM public.leases WHERE id = $1', [t.lease]));
    expect(msg).toBe(`This lease has 1 posted month. ${OVERRIDE_HINT}`);
  });

  it('blocks deleting the organization, its locked periods and posted month-end documents', async () => {
    const t = await tenantWithPostedMonths(['2026-01', '2026-02']);
    expect(await errorOf(db.query('DELETE FROM public.organizations WHERE id = $1', [t.org])))
      .toBe(`This organization has 2 posted months. ${OVERRIDE_HINT}`);
    expect(await errorOf(db.query('DELETE FROM public.accounting_periods WHERE organization_id = $1', [t.org])))
      .toContain(OVERRIDE_HINT);
    expect(await count('SELECT count(*) AS n FROM public.accounting_periods WHERE organization_id = $1', [t.org])).toBe(2);
  });

  it('blocks deleting the owning user when that cascades into posted months', async () => {
    const t = await tenantWithPostedMonths(['2025-01']);
    await db.query('DELETE FROM public.leases WHERE id = $1', [t.lease]);
    const msg = await errorOf(db.query('DELETE FROM auth.users WHERE id = $1', [t.id]));
    expect(msg).toContain(OVERRIDE_HINT);
    expect(await count('SELECT count(*) AS n FROM public.companies WHERE id = $1', [t.company])).toBe(1);
  });

  it('still allows deleting leases and companies when nothing is posted', async () => {
    const t = await tenantWithPostedMonths([]);
    await db.query('DELETE FROM public.leases WHERE id = $1', [t.lease]);
    await db.query('DELETE FROM public.companies WHERE id = $1', [t.company]);
    expect(await count('SELECT count(*) AS n FROM public.companies WHERE id = $1', [t.company])).toBe(0);
  });

  it('still allows a signed-in user to delete a lease outside posted months', async () => {
    const t = await tenantWithPostedMonths(['2025-01']);
    await asUser(t.id, () => db.query('DELETE FROM public.leases WHERE id = $1', [t.lease]));
    expect(await count('SELECT count(*) AS n FROM public.leases WHERE id = $1', [t.lease])).toBe(0);
  });
});

describe('platform-owner deletion override', () => {
  async function platformOwner(): Promise<string> {
    const t = await tenantWithPostedMonths([], 'Owner Co');
    await db.query('INSERT INTO internal.platform_admins (user_id) VALUES ($1)', [t.id]);
    return t.id;
  }

  it('refuses callers who are not platform admins', async () => {
    const t = await tenantWithPostedMonths(['2026-01']);
    const msg = await asUser(t.id, () => errorOf(db.query("SELECT public.platform_owner_force_delete('company', $1, 'MS Consulting')", [t.company])));
    expect(msg).toBe('Not authorized');
    expect(await errorOf(db.query("SELECT public.platform_owner_force_delete('company', $1, 'MS Consulting')", [t.company]))).toBe('Not authorized');
  });

  it('requires the exact company name as confirmation', async () => {
    const owner = await platformOwner();
    const t = await tenantWithPostedMonths(['2026-01']);
    const msg = await asUser(owner, () => errorOf(db.query("SELECT public.platform_owner_force_delete('company', $1, 'ms consulting')", [t.company])));
    expect(msg).toContain('Confirmation does not match');
    expect(await count('SELECT count(*) AS n FROM public.companies WHERE id = $1', [t.company])).toBe(1);
  });

  it('previews, then deletes the company with an audit entry holding the counts', async () => {
    const owner = await platformOwner();
    const t = await tenantWithPostedMonths(['2026-01', '2026-02']);

    const preview = await asUser(owner, () => one<{ p: { posted_months: number; rows: Record<string, number> } }>(
      "SELECT public.platform_owner_deletion_preview('company', $1) AS p", [t.company]));
    expect(preview.p.posted_months).toBe(2);
    expect(preview.p.rows).toMatchObject({ leases: 1, companies: 1 });

    const result = await asUser(owner, () => one<{ r: { name: string; rows: Record<string, number> } }>(
      "SELECT public.platform_owner_force_delete('company', $1, ' MS Consulting ') AS r", [t.company]));
    expect(result.r).toMatchObject({ name: 'MS Consulting', rows: { leases: 1, companies: 1 } });

    expect(await count('SELECT count(*) AS n FROM public.companies WHERE id = $1', [t.company])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.leases WHERE id = $1', [t.lease])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.accounting_periods WHERE organization_id = $1', [t.org])).toBe(2);

    const audit = await one<{ actor_user_id: string; new_data: { posted_months: number; rows: Record<string, number> } }>(
      "SELECT actor_user_id, new_data FROM public.audit_log WHERE action = 'Platform-owner deletion' AND record_id = $1", [t.company]);
    expect(audit.actor_user_id).toBe(owner);
    expect(audit.new_data.posted_months).toBe(2);
    expect(audit.new_data.rows.leases).toBe(1);
  });

  it('organization scope removes accounting data but keeps users, subscription and audit log', async () => {
    const owner = await platformOwner();
    const t = await tenantWithPostedMonths(['2026-01', '2026-02', '2026-03'], 'MS New York');
    const { name } = await one<{ name: string }>('SELECT name FROM public.organizations WHERE id = $1', [t.org]);
    await asUser(owner, () => db.query("SELECT public.platform_owner_force_delete('organization', $1, $2)", [t.org, name]));

    expect(await count('SELECT count(*) AS n FROM public.leases WHERE organization_id = $1', [t.org])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.companies WHERE organization_id = $1', [t.org])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.accounting_periods WHERE organization_id = $1', [t.org])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.organizations WHERE id = $1', [t.org])).toBe(1);
    expect(await count('SELECT count(*) AS n FROM public.user_profiles WHERE organization_id = $1', [t.org])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM public.audit_log WHERE organization_id = $1 AND action = 'Platform-owner deletion'", [t.org])).toBe(1);
  });

  it('does not leave the override open after the deletion finishes', async () => {
    const owner = await platformOwner();
    const a = await tenantWithPostedMonths(['2026-01'], 'Alpha');
    const b = await tenantWithPostedMonths(['2026-01'], 'Beta');
    await asUser(owner, () => db.query("SELECT public.platform_owner_force_delete('company', $1, 'Alpha')", [a.company]));
    expect(await errorOf(db.query('DELETE FROM public.companies WHERE id = $1', [b.company]))).toContain(OVERRIDE_HINT);
  });

  it('keeps the override functions away from anonymous visitors', async () => {
    const grants = await rows<{ fn: string; anon: boolean; authed: boolean }>(
      `SELECT p.proname AS fn, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed
       FROM pg_proc p WHERE p.proname IN ('platform_owner_force_delete', 'platform_owner_deletion_preview') ORDER BY 1`);
    expect(grants).toEqual([
      { fn: 'platform_owner_deletion_preview', anon: false, authed: true },
      { fn: 'platform_owner_force_delete', anon: false, authed: true },
    ]);
  });
});

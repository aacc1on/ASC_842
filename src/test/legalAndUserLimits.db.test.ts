// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

/*
 * Applies every migration to an empty Postgres and exercises the legal-acceptance and
 * per-plan user-limit rules exactly as the live database runs them.
 */

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const LIMIT_MESSAGE = 'Your plan allows up to 10 users. Remove a user or contact us to add more.';

let db: PGlite;
let seq = 0;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await rows<T>(sql, params))[0];
}

const legalMeta = { terms_accepted: true, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };

async function signUp(userMeta: Record<string, unknown> = legalMeta): Promise<{ id: string; org: string }> {
  seq += 1;
  const { id } = await one<{ id: string }>(
    "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id",
    [`owner${seq}@example.com`, JSON.stringify(userMeta)],
  );
  const { organization_id } = await one<{ organization_id: string }>('SELECT organization_id FROM public.user_profiles WHERE user_id = $1', [id]);
  return { id, org: organization_id };
}

async function invite(org: string): Promise<string> {
  seq += 1;
  const { id } = await one<{ id: string }>(
    "INSERT INTO auth.users (email, raw_app_meta_data) VALUES ($1, $2) RETURNING id",
    [`member${seq}@example.com`, JSON.stringify({ organization_id: org })],
  );
  return id;
}

async function inviteMany(org: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await invite(org));
  return ids;
}

async function setPlan(org: string, planKey: string, status = 'active') {
  await db.query(
    "UPDATE public.subscriptions SET plan_key = $2, status = $3, trial_ends_at = CASE WHEN $3 = 'trialing' THEN now() + interval '5 days' ELSE NULL END, current_period_end = CASE WHEN $3 = 'active' THEN now() + interval '30 days' ELSE now() - interval '30 days' END WHERE organization_id = $1",
    [org, planKey, status],
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

const activeCount = async (org: string) =>
  (await one<{ n: number }>('SELECT internal.org_active_user_count($1, NULL) AS n', [org])).n;

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

describe('legal acceptance (database)', () => {
  it('publishes the current Terms and Privacy versions', async () => {
    const docs = await rows<{ doc: string; version: string }>('SELECT doc, version FROM public.legal_documents WHERE is_current ORDER BY doc');
    expect(docs).toEqual([{ doc: 'privacy', version: PRIVACY_VERSION }, { doc: 'terms', version: TERMS_VERSION }]);
  });

  it('keeps the earlier 2026-10-13 versions and asks their signers to accept the new version', async () => {
    const older = await rows<{ doc: string; is_current: boolean }>("SELECT doc, is_current FROM public.legal_documents WHERE version = '2026-10-13' ORDER BY doc");
    expect(older).toEqual([{ doc: 'privacy', is_current: false }, { doc: 'terms', is_current: false }]);

    const { id, org } = await signUp({});
    await db.query(
      "INSERT INTO public.legal_acceptances (user_id, organization_id, doc, version, source) VALUES ($1, $2, 'terms', '2026-10-13', 'signup'), ($1, $2, 'privacy', '2026-10-13', 'signup')",
      [id, org],
    );
    const status = await asUser(id, () => one<{ s: { accepted: boolean; has_prior_acceptance: boolean } }>('SELECT public.my_legal_status() AS s'));
    expect(status.s).toMatchObject({ accepted: false, has_prior_acceptance: true });
  });

  it('versions the documents independently: Terms 2026-10-14 and Privacy 2026-10-15 are current, old rows kept', async () => {
    const all = await rows<{ doc: string; version: string; is_current: boolean }>('SELECT doc, version, is_current FROM public.legal_documents ORDER BY doc, version');
    expect(all).toEqual([
      { doc: 'privacy', version: '2026-10-13', is_current: false },
      { doc: 'privacy', version: '2026-10-14', is_current: false },
      { doc: 'privacy', version: '2026-10-15', is_current: true },
      { doc: 'terms', version: '2026-10-13', is_current: false },
      { doc: 'terms', version: '2026-10-14', is_current: true },
    ]);
    expect([TERMS_VERSION, PRIVACY_VERSION]).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('asks a 2026-10-14 signer to accept only the updated Privacy Policy, and records just that', async () => {
    const { id, org } = await signUp({});
    await db.query(
      "INSERT INTO public.legal_acceptances (user_id, organization_id, doc, version, source) VALUES ($1, $2, 'terms', '2026-10-14', 'signup'), ($1, $2, 'privacy', '2026-10-14', 'signup')",
      [id, org],
    );
    await asUser(id, async () => {
      const before = await one<{ s: Record<string, unknown> }>('SELECT public.my_legal_status() AS s');
      expect(before.s).toMatchObject({ accepted: false, terms_accepted: true, privacy_accepted: false, has_prior_acceptance: true, terms_version: '2026-10-14', privacy_version: '2026-10-15' });

      const after = await one<{ s: Record<string, unknown> }>("SELECT public.accept_legal_documents('2026-10-14', '2026-10-15', 'reaccept') AS s");
      expect(after.s).toMatchObject({ accepted: true, terms_accepted: true, privacy_accepted: true });

      const stalePrivacy = await errorOf(db.query("SELECT public.accept_legal_documents('2026-10-14', '2026-10-14', 'reaccept')"));
      expect(stalePrivacy).toContain('These terms have been updated');
    });
    const recorded = await rows<{ doc: string; version: string; source: string }>('SELECT doc, version, source FROM public.legal_acceptances WHERE user_id = $1 ORDER BY doc, version', [id]);
    expect(recorded).toEqual([
      { doc: 'privacy', version: '2026-10-14', source: 'signup' },
      { doc: 'privacy', version: '2026-10-15', source: 'reaccept' },
      { doc: 'terms', version: '2026-10-14', source: 'signup' },
    ]);
  });

  it('records Terms 2026-10-14 and Privacy 2026-10-15 for a new sign-up, and nothing for the old Privacy version', async () => {
    const fresh = await signUp({ terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15' });
    const recorded = await rows<{ doc: string; version: string }>('SELECT doc, version FROM public.legal_acceptances WHERE user_id = $1 ORDER BY doc', [fresh.id]);
    expect(recorded).toEqual([{ doc: 'privacy', version: '2026-10-15' }, { doc: 'terms', version: '2026-10-14' }]);

    const stale = await signUp({ terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-14' });
    const { n } = await one<{ n: number }>('SELECT count(*)::int AS n FROM public.legal_acceptances WHERE user_id = $1', [stale.id]);
    expect(n).toBe(0);
  });

  it('records the sign-up acceptance from the account metadata, using server time', async () => {
    const before = await one<{ now: Date }>('SELECT now() AS now');
    const { id, org } = await signUp();
    const recorded = await rows<{ doc: string; version: string; source: string; organization_id: string; accepted_at: Date }>(
      'SELECT doc, version, source, organization_id, accepted_at FROM public.legal_acceptances WHERE user_id = $1 ORDER BY doc', [id]);
    expect(recorded.map((r) => [r.doc, r.version, r.source, r.organization_id])).toEqual([
      ['privacy', PRIVACY_VERSION, 'signup', org],
      ['terms', TERMS_VERSION, 'signup', org],
    ]);
    expect(recorded[0].accepted_at.getTime()).toBeGreaterThanOrEqual(before.now.getTime());
  });

  it('records nothing at sign-up when the box was not ticked or the versions are stale', async () => {
    const unticked = await signUp({});
    const stale = await signUp({ ...legalMeta, terms_version: '2020-01-01' });
    const { n } = await one<{ n: number }>('SELECT count(*)::int AS n FROM public.legal_acceptances WHERE user_id = ANY($1)', [[unticked.id, stale.id]]);
    expect(n).toBe(0);
  });

  it('reports status, accepts idempotently, and rejects stale versions', async () => {
    const { id } = await signUp({});
    await asUser(id, async () => {
      const before = await one<{ s: { accepted: boolean; has_prior_acceptance: boolean } }>('SELECT public.my_legal_status() AS s');
      expect(before.s).toMatchObject({ accepted: false, has_prior_acceptance: false });

      const stale = await errorOf(db.query("SELECT public.accept_legal_documents('2020-01-01', $1, 'invite')", [PRIVACY_VERSION]));
      expect(stale).toContain('These terms have been updated');

      const first = await one<{ s: { accepted: boolean } }>("SELECT public.accept_legal_documents($1, $2, 'invite', 'test-agent') AS s", [TERMS_VERSION, PRIVACY_VERSION]);
      expect(first.s.accepted).toBe(true);
      const again = await one<{ s: { accepted: boolean } }>("SELECT public.accept_legal_documents($1, $2, 'reaccept') AS s", [TERMS_VERSION, PRIVACY_VERSION]);
      expect(again.s.accepted).toBe(true);
    });
    const recorded = await rows<{ doc: string; source: string }>('SELECT doc, source FROM public.legal_acceptances WHERE user_id = $1 ORDER BY doc', [id]);
    expect(recorded).toEqual([{ doc: 'privacy', source: 'invite' }, { doc: 'terms', source: 'invite' }]);
  });

  it('rejects sources other than invite and reaccept from the app', async () => {
    const { id } = await signUp({});
    const message = await asUser(id, () => errorOf(db.query("SELECT public.accept_legal_documents($1, $2, 'signup')", [TERMS_VERSION, PRIVACY_VERSION])));
    expect(message).not.toBe('');
  });

  it('keeps acceptance records append-only', async () => {
    const { id } = await signUp();
    expect(await errorOf(db.query("UPDATE public.legal_acceptances SET version = 'x' WHERE user_id = $1", [id]))).toContain('append-only');
    expect(await errorOf(db.query('DELETE FROM public.legal_acceptances WHERE user_id = $1', [id]))).toContain('append-only');
    const asOwner = await asUser(id, () => errorOf(db.query('DELETE FROM public.legal_acceptances WHERE user_id = $1', [id])));
    expect(asOwner).not.toBe('');
    const { n } = await one<{ n: number }>('SELECT count(*)::int AS n FROM public.legal_acceptances WHERE user_id = $1', [id]);
    expect(n).toBe(2);
  });

  it('removes the records only when the account itself is deleted', async () => {
    const { id } = await signUp();
    await db.query('DELETE FROM auth.users WHERE id = $1', [id]);
    const { n } = await one<{ n: number }>('SELECT count(*)::int AS n FROM public.legal_acceptances WHERE user_id = $1', [id]);
    expect(n).toBe(0);
  });

  it("does not let a user read another user's acceptances", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const seen = await asUser(bob.id, () => rows<{ user_id: string }>('SELECT user_id FROM public.legal_acceptances'));
    expect(seen.length).toBe(2);
    expect(seen.every((r) => r.user_id === bob.id)).toBe(true);
    expect(seen.some((r) => r.user_id === alice.id)).toBe(false);
  });
});

describe('user limits per plan (database)', () => {
  it('sets 1 user for Starter and Professional and 10 for Enterprise', async () => {
    const plans = await rows<{ plan_key: string; max_users: number }>('SELECT plan_key, max_users FROM public.subscription_plans ORDER BY max_users, plan_key');
    expect(plans).toEqual([
      { plan_key: 'professional', max_users: 1 },
      { plan_key: 'starter', max_users: 1 },
      { plan_key: 'enterprise', max_users: 10 },
    ]);
    const { features } = await one<{ features: string[] }>("SELECT features FROM public.subscription_plans WHERE plan_key = 'enterprise'");
    expect(features).toContain('Up to 10 users');
    expect(features).not.toContain('Multi-user & team roles');
  });

  it('gives the free trial 10 users and expired or single-user plans 1', async () => {
    const { org } = await signUp();
    const max = async () => (await one<{ m: number }>('SELECT internal.org_max_users($1) AS m', [org])).m;
    expect(await max()).toBe(10);
    await setPlan(org, 'starter');
    expect(await max()).toBe(1);
    await setPlan(org, 'professional');
    expect(await max()).toBe(1);
    await setPlan(org, 'enterprise');
    expect(await max()).toBe(10);
    await setPlan(org, 'enterprise', 'past_due');
    expect(await max()).toBe(1);
  });

  it('allows the 10th user and rejects the 11th on Enterprise', async () => {
    const { org } = await signUp();
    await setPlan(org, 'enterprise');
    await inviteMany(org, 9);
    expect(await activeCount(org)).toBe(10);
    expect(await errorOf(invite(org))).toBe(LIMIT_MESSAGE);
    expect(await activeCount(org)).toBe(10);
  });

  it('allows the 10th user and rejects the 11th during the free trial', async () => {
    const { org } = await signUp();
    await inviteMany(org, 9);
    expect(await errorOf(invite(org))).toBe(LIMIT_MESSAGE);
  });

  it('rejects a second user on Starter and Professional', async () => {
    for (const plan of ['starter', 'professional']) {
      const { org } = await signUp();
      await setPlan(org, plan);
      expect(await errorOf(invite(org))).toContain('Multiple users require the Enterprise plan');
    }
  });

  it('lets only one of two invites through when the org is at 9 users', async () => {
    const { org } = await signUp();
    await setPlan(org, 'enterprise');
    await inviteMany(org, 8);
    await db.exec('BEGIN');
    await invite(org);
    const { locks } = await one<{ locks: number }>("SELECT count(*)::int AS locks FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()");
    expect(locks).toBeGreaterThan(0);
    await db.exec('COMMIT');
    expect(await errorOf(invite(org))).toBe(LIMIT_MESSAGE);
    expect(await activeCount(org)).toBe(10);
  });

  it('does not count removed or deactivated users, and applies the limit on reactivation', async () => {
    const { org } = await signUp();
    await setPlan(org, 'enterprise');
    const members = await inviteMany(org, 9);

    await db.query('DELETE FROM auth.users WHERE id = $1', [members[0]]);
    expect(await activeCount(org)).toBe(9);
    await invite(org);

    await db.query("UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = $1", [members[1]]);
    expect(await activeCount(org)).toBe(9);
    await invite(org);
    expect(await activeCount(org)).toBe(10);

    expect(await errorOf(db.query('UPDATE auth.users SET banned_until = NULL WHERE id = $1', [members[1]]))).toBe(LIMIT_MESSAGE);
    const { banned } = await one<{ banned: boolean }>('SELECT banned_until > now() AS banned FROM auth.users WHERE id = $1', [members[1]]);
    expect(banned).toBe(true);
  });

  it('does not count the platform owner', async () => {
    const { org } = await signUp();
    await setPlan(org, 'enterprise');
    await inviteMany(org, 9);
    const owner = await one<{ id: string }>("INSERT INTO auth.users (email) VALUES ('platform-owner-test@example.com') RETURNING id");
    await db.query('INSERT INTO internal.platform_admins (user_id) VALUES ($1)', [owner.id]);
    await db.query('UPDATE public.user_profiles SET organization_id = $2 WHERE user_id = $1', [owner.id, org]);
    expect(await activeCount(org)).toBe(10);
  });

  it('reports usage in get_my_plan and flags orgs over their limit without removing anyone', async () => {
    const { id, org } = await signUp();
    await setPlan(org, 'enterprise');
    await inviteMany(org, 2);
    const plan = async () => (await asUser(id, () => one<{ p: { max_users: number; active_users: number; over_user_limit: boolean } }>('SELECT public.get_my_plan() AS p'))).p;

    expect(await plan()).toMatchObject({ max_users: 10, active_users: 3, over_user_limit: false });
    await setPlan(org, 'starter');
    expect(await plan()).toMatchObject({ max_users: 1, active_users: 3, over_user_limit: true });
    const { n } = await one<{ n: number }>('SELECT count(*)::int AS n FROM public.user_profiles WHERE organization_id = $1', [org]);
    expect(n).toBe(3);
  });

  it('exposes the capacity check to the server only', async () => {
    const { id, org } = await signUp();
    const denied = await asUser(id, () => errorOf(db.query('SELECT public.org_user_capacity($1)', [org])));
    expect(denied).toContain('permission denied');
    const { c } = await one<{ c: { used: number; max: number } }>('SELECT public.org_user_capacity($1) AS c', [org]);
    expect(c).toEqual({ used: 1, max: 10 });
  });
});

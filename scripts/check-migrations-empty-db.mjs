#!/usr/bin/env node
// Applies every file in supabase/migrations, in order, to an EMPTY Postgres (PGlite) with minimal
// stand-ins for Supabase's built-in auth/storage schemas and roles. Proves a fresh database (staging)
// can be rebuilt from scratch. Optional: `--seed <file>` applies a seed afterwards, then generates the demo
// leases' schedules + journal entries through the app's own code (as the RESET does) and verifies them.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDemoSchedules } from './staging/load-demo-schedules.mjs';

const DIR = 'supabase/migrations';
const seedIndex = process.argv.indexOf('--seed');
const seedFile = seedIndex > -1 ? process.argv[seedIndex + 1] : null;

const SUPABASE_STANDINS = readFileSync('scripts/supabase-standins.sql', 'utf8');

const db = new PGlite();
await db.exec(SUPABASE_STANDINS);

const files = readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const failures = [];
for (const file of files) {
  try {
    await db.exec('BEGIN;');
    await db.exec(readFileSync(join(DIR, file), 'utf8'));
    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;').catch(() => {});
    failures.push(`${file}: ${err.message}`);
    if (process.env.STOP_ON_FAIL) break;
  }
}

if (failures.length) {
  console.error(`Empty-database migration check failed (${failures.length} of ${files.length}):\n` + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Empty-database migration check passed: ${files.length} migrations applied in order.`);

const { rows: legalDocs } = await db.query("SELECT doc FROM public.legal_documents WHERE is_current ORDER BY doc");
const { rows: planLimits } = await db.query("SELECT plan_key, max_users FROM public.subscription_plans ORDER BY plan_key");
const limits = Object.fromEntries(planLimits.map((r) => [r.plan_key, r.max_users]));
const setupProblems = [];
if (legalDocs.map((r) => r.doc).join(',') !== 'privacy,terms') setupProblems.push(`current legal documents are [${legalDocs.map((r) => r.doc)}], expected privacy and terms`);
if (limits.starter !== 1 || limits.professional !== 1 || limits.enterprise !== 10) setupProblems.push(`plan user limits are ${JSON.stringify(limits)}, expected starter 1, professional 1, enterprise 10`);
if (setupProblems.length) {
  console.error(`Empty-database setup check failed:\n  - ${setupProblems.join('\n  - ')}`);
  process.exit(1);
}
console.log('Legal documents and plan user limits present.');

if (seedFile) {
  try {
    await db.exec(readFileSync(seedFile, 'utf8'));
    const { rows } = await db.query('SELECT lease_classification, count(*)::int AS leases, sum(lease_liability)::text AS liability FROM public.leases GROUP BY 1 ORDER BY 1');
    console.log(`Seed ${seedFile} applied: ${JSON.stringify(rows)}`);
  } catch (err) {
    console.error(`Seed ${seedFile} failed: ${err.message}`);
    process.exit(1);
  }

  const DEMO_USER = 'de300000-0000-4000-8000-000000000001';
  // Shape rows like the API's JSON: dates stay YYYY-MM-DD strings, numeric columns become numbers.
  const apiParsers = { 1082: (v) => v, 1700: (v) => Number(v) };
  const select = async (sql, params) => (await db.query(sql, params, { parsers: apiParsers })).rows;

  // Calls the server functions the way the API does for a signed-in demo user.
  const store = {
    listLeases: () => select('SELECT * FROM public.leases WHERE user_id = $1 ORDER BY lease_name', [DEMO_USER]),
    getLease: async (id) => (await select('SELECT * FROM public.leases WHERE id = $1', [id]))[0],
    listSchedule: (id) => select('SELECT * FROM public.amortization_schedules WHERE lease_id = $1 ORDER BY period_number', [id]),
    async rpc(fn, args) {
      const names = Object.keys(args);
      const sql = `SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS result`;
      const params = names.map((n) => (typeof args[n] === 'string' ? args[n] : JSON.stringify(args[n])));
      const { rows } = await db.query(sql, params);
      return rows[0]?.result;
    },
  };

  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [DEMO_USER]);
    const { generateDemoSchedules } = await loadDemoSchedules();
    const results = await generateDemoSchedules(store);
    console.log(`Demo schedules generated: ${results.map((r) => `${r.lease} ${r.periods}p/${r.journalEntries}je`).join('; ')}`);
    const { rows } = await db.query(readFileSync('scripts/staging/verify-demo-data.sql', 'utf8'));
    const check = rows[0];
    if (!check || check.problems.length > 0) {
      console.error(`Demo data verification failed:\n  - ${(check?.problems ?? ['no result']).join('\n  - ')}`);
      process.exit(1);
    }
    console.log(`Demo data verified: ${check.leases} leases, ${check.schedule_rows} schedule rows, ${check.journal_entries} journal entries, debits ${check.total_debits} = credits ${check.total_credits}.`);
  } catch (err) {
    console.error(`Demo schedule generation failed: ${err.message}`);
    process.exit(1);
  }
}

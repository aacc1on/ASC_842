#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Migrations up to this timestamp are already applied and frozen; never edit them.
const LAST_FROZEN = '20261012195012';
const DIR = 'supabase/migrations';
const FORBIDDEN = /\b(regexp_replace|pg_get_functiondef)\b/i;
// Hard-coded row ids only exist on one database; a fresh (staging) rebuild would fail or diverge.
const UUID_LITERAL = /'(?!00000000-0000-0000-0000-000000000000')[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i;

const problems = [];
const versions = new Map();
for (const name of readdirSync(DIR).sort()) {
  const stamp = name.match(/^(\d{14})_/)?.[1];
  if (stamp) {
    if (versions.has(stamp)) problems.push(`${name}: duplicate version ${stamp} (also ${versions.get(stamp)})`);
    versions.set(stamp, name);
  }
  if (stamp && stamp <= LAST_FROZEN) continue;
  if (!stamp) problems.push(`${name}: must start with a 14-digit timestamp`);
  if (/\.sql\.sql$/i.test(name)) problems.push(`${name}: ends with .sql.sql`);
  else if (!name.endsWith('.sql')) problems.push(`${name}: must end with .sql`);
  const sql = readFileSync(join(DIR, name), 'utf8');
  if (FORBIDDEN.test(sql)) {
    problems.push(`${name}: rewrites functions via regexp_replace/pg_get_functiondef; use a full CREATE OR REPLACE FUNCTION`);
  }
  if (UUID_LITERAL.test(sql)) {
    problems.push(`${name}: hard-codes a row id; look rows up by a stable key so the migration also applies to an empty database`);
  }
}

if (problems.length) {
  console.error('Migration hygiene check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('Migration hygiene check passed.');

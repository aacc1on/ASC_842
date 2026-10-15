import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ORG_SCOPED_TABLES } from './currentOrg';

const ROOT = join(__dirname, '..');
const SCANNED = ['hooks', 'utils', 'components', 'App.tsx'];
const ORG_FILTER = /\.(eq|in)\(\s*['"`]organization_id['"`]|\.match\(\s*\{[^}]*organization_id/;

/**
 * Reads that intentionally have no organization filter. RLS still scopes them; each entry
 * names the file and table and says why an explicit filter does not apply.
 */
const ALLOWED: Record<string, string> = {
  'utils/currentOrg.ts:user_profiles': 'resolves the organization itself, by the signed-in user id',
  'hooks/useUserProfile.ts:user_profiles': 'looks up the signed-in user own profile by user id',
  'App.tsx:user_profiles': 'loads the signed-in user own role by user id',
};

function sourceFiles(dir: string): string[] {
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const blankComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Accepts `let q = supabase.from(t).select(...); q = q.eq('organization_id', org)`. */
function filteredOnReassignment(before: string, after: string): boolean {
  const decl = /(?:let|const|var)\s+(\w+)\s*=\s*(?:await\s+)?supabase\s*$/.exec(before.trimEnd());
  if (!decl) return false;
  const name = decl[1];
  return new RegExp(`${name}\\s*=\\s*${name}[\\s\\S]{0,80}\\.eq\\(\\s*['"\`]organization_id`).test(after.slice(0, 1500));
}

function unscopedReads(raw: string): { table: string; line: number }[] {
  const source = blankComments(raw);
  const tables = new Set<string>(ORG_SCOPED_TABLES);
  const found: { table: string; line: number }[] = [];
  const re = /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (!tables.has(m[1])) continue;
    const rest = source.slice(m.index + m[0].length);
    const end = rest.search(/;|\.from\(/);
    const chain = end === -1 ? rest : rest.slice(0, end);
    if (!/^\s*\.select\(/.test(chain)) continue;
    if (ORG_FILTER.test(chain)) continue;
    if (filteredOnReassignment(source.slice(0, m.index), rest.slice(chain.length))) continue;
    found.push({ table: m[1], line: source.slice(0, m.index).split('\n').length });
  }
  return found;
}

describe('org-scoped reads carry an explicit organization filter', () => {
  it('detects a read without an organization filter and accepts one with it', () => {
    expect(unscopedReads("supabase.from('leases').select('*').eq('id', x);")).toEqual([{ table: 'leases', line: 1 }]);
    expect(unscopedReads("supabase.from('leases').select('*').eq('organization_id', org).eq('id', x);")).toEqual([]);
    expect(unscopedReads("supabase.from('leases').update({ a: 1 }).eq('id', x);")).toEqual([]);
    expect(unscopedReads("supabase.from('subscription_plans').select('*');")).toEqual([]);
    expect(unscopedReads("supabase.from('leases').select('id, organization_id').eq('id', x);")).toEqual([{ table: 'leases', line: 1 }]);
    expect(unscopedReads("let q = supabase.from('leases').select('*');\nq = q.eq('organization_id', org);")).toEqual([]);
    expect(unscopedReads("let q = supabase.from('leases').select('*');\nq = q.eq('id', x);")).toEqual([{ table: 'leases', line: 1 }]);
    expect(unscopedReads("/* supabase.from('leases').select('*') */\n// supabase.from('leases').select('*');")).toEqual([]);
  });

  it('every read of an org-scoped table in hooks, utils and screens filters by organization_id', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split('\\').join('/');
        for (const { table, line } of unscopedReads(readFileSync(file, 'utf8'))) {
          if (!ALLOWED[`${rel}:${table}`]) offenders.push(`${rel}:${line} reads ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

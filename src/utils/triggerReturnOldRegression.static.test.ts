import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression test: every BEFORE DELETE trigger function in the migrations
 * must return OLD (not NEW) when TG_OP = 'DELETE'. Returning NEW on a DELETE
 * returns NULL, which silently cancels the deletion with no error — the
 * "silent-delete bug" that trapped $0.00 recognition rows and would have
 * trapped journal entry / month-end / transaction deletes.
 *
 * Since later migrations can CREATE OR REPLACE a function, this test finds
 * the LAST (most recent) definition of each function across all migrations.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function loadMigrationFilesSorted(): { filename: string; content: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // migrations are named with timestamps, so sort gives chronological order
    .map((f) => ({ filename: f, content: readFileSync(join(MIGRATIONS_DIR, f), 'utf-8') }));
}

/**
 * Extract the LAST function body for `funcName` from the sorted migration files.
 * Later migrations override earlier ones via CREATE OR REPLACE.
 */
function extractLastFunctionBody(files: { filename: string; content: string }[], funcName: string): string | null {
  let lastBody: string | null = null;
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:\\w+\\.)?${funcName}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s*\\$\\$([\\s\\S]*?)\\$\\$`,
    'i',
  );
  for (const f of files) {
    const match = f.content.match(re);
    if (match) {
      lastBody = match[1]; // keep updating — last one wins
    }
  }
  return lastBody;
}

describe('Trigger return-value regression: BEFORE DELETE functions must return OLD', () => {
  const files = loadMigrationFilesSorted();
  const allSQL = files.map((f) => f.content).join('\n\n');

  // Functions used for BEFORE DELETE triggers — must return OLD.
  const deleteTriggerFunctions = [
    'prevent_period_locked_mutation_lt',
    'prevent_period_locked_mutation_je',
    'prevent_month_end_mutation',
    'prevent_posted_transaction_mutation',
  ];

  for (const funcName of deleteTriggerFunctions) {
    it(`${funcName}() latest definition includes RETURN OLD`, () => {
      const body = extractLastFunctionBody(files, funcName);
      expect(body, `Could not find function body for ${funcName} in any migration`).not.toBeNull();
      expect(body!).toContain('RETURN OLD');
    });
  }

  it('prevent_audit_log_mutation always raises (no return needed)', () => {
    const body = extractLastFunctionBody(files, 'prevent_audit_log_mutation');
    expect(body).not.toBeNull();
    expect(body!).toContain('RAISE EXCEPTION');
    expect(body!).not.toContain('RETURN OLD');
    expect(body!).not.toContain('RETURN NEW');
  });

  it('prevent_zero_amount_recognition is INSERT/UPDATE only (no DELETE)', () => {
    const body = extractLastFunctionBody(files, 'prevent_zero_amount_recognition');
    expect(body).not.toBeNull();
    expect(body!).toContain('RETURN NEW');
    expect(body!).not.toContain('RETURN OLD');
    expect(allSQL).not.toMatch(/prevent_zero_amount_recognition.*DELETE/i);
  });
});

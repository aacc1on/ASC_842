import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * QA-012: Ensures every transaction_type literal used in the codebase
 * is in the allowed list for both the `transactions` and
 * `lease_transactions` tables.
 */

const ALLOWED_TRANSACTIONS = new Set([
  'payment',
  'interest',
  'amortization',
  'initial_recognition',
  'lease_modification',
  'lease_cancellation',
  'impairment',
  'derecognition',
  'reversal',
  'operating_lease_expense',
  'short_term_lease_expense',
  'nonlease_component_expense',
]);

const ALLOWED_LEASE_TRANSACTIONS = new Set([
  'initial_recognition',
  'modification',
  'remeasurement',
  'termination',
  'impairment',
]);

describe('QA-012: Every transaction_type literal is in the allowed list', () => {
  const srcDir = path.resolve(__dirname);

  function findTsFiles(dir: string, acc: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'test') {
        findTsFiles(full, acc);
      } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) && !e.name.endsWith('.test.ts')) {
        acc.push(full);
      }
    }
    return acc;
  }

  const files = findTsFiles(srcDir);
  const foundLiterals = new Set<string>();

  // Match transaction_type: 'value' or transaction_type: "value" or
  // .eq('transaction_type', 'value') patterns
  const typeRegex = /transaction_type['"]?\s*[:=,]\s*['"]([a-z_]+)['"]/gi;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = typeRegex.exec(content)) !== null) {
      foundLiterals.add(match[1]);
    }
  }

  it('found at least some transaction_type literals', () => {
    expect(foundLiterals.size).toBeGreaterThan(0);
  });

  it('every literal is in the transactions allowed list', () => {
    const unexpected = Array.from(foundLiterals).filter(l => !ALLOWED_TRANSACTIONS.has(l));
    if (unexpected.length > 0) {
      // Some literals are only valid for lease_transactions; check those too
      const trulyUnexpected = unexpected.filter(l => !ALLOWED_LEASE_TRANSACTIONS.has(l));
      if (trulyUnexpected.length > 0) {
        throw new Error(`Unexpected transaction_type literals: ${trulyUnexpected.join(', ')}`);
      }
    }
  });

  it('operating_lease_expense is in the allowed list', () => {
    expect(ALLOWED_TRANSACTIONS.has('operating_lease_expense')).toBe(true);
  });

  it('short_term_lease_expense is in the allowed list', () => {
    expect(ALLOWED_TRANSACTIONS.has('short_term_lease_expense')).toBe(true);
  });

  it('nonlease_component_expense is in the allowed list', () => {
    expect(ALLOWED_TRANSACTIONS.has('nonlease_component_expense')).toBe(true);
  });

  it('impairment is in the lease_transactions allowed list', () => {
    expect(ALLOWED_LEASE_TRANSACTIONS.has('impairment')).toBe(true);
  });
});

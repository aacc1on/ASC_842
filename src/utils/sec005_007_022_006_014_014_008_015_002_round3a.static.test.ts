import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeCellForExcel } from './csvExport';
import { round2 } from './leaseCalculations';

const projectRoot = join(__dirname, '..', '..');

describe('SEC-005: xlsx replaced with SheetJS CDN build', () => {
  it('package.json no longer references xlsx ^0.18.5', () => {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    const xlsxDep = pkg.dependencies?.xlsx;
    expect(xlsxDep).toBeDefined();
    expect(xlsxDep).not.toBe('^0.18.5');
    expect(xlsxDep).toContain('cdn.sheetjs.com');
  });
});

describe('SEC-007: CI includes npm audit', () => {
  it('ci.yml contains npm audit step', () => {
    const ci = readFileSync(join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci).toContain('npm audit');
    expect(ci).toContain('--audit-level=high');
  });
});

describe('SEC-022: Security headers', () => {
  it('_headers file contains CSP, X-Frame-Options, and other security headers', () => {
    const headers = readFileSync(join(projectRoot, 'public', '_headers'), 'utf-8');
    expect(headers).toContain('Content-Security-Policy');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('Permissions-Policy');
    expect(headers).toContain('Strict-Transport-Security');
  });

  it('index.html has a CSP meta tag', () => {
    const html = readFileSync(join(projectRoot, 'index.html'), 'utf-8');
    expect(html).toContain('Content-Security-Policy');
  });
});

describe('SEC-006: CSV formula injection protection', () => {
  it('sanitizeCellForExcel prefixes formula characters with single quote', () => {
    expect(sanitizeCellForExcel('=cmd|/C calc!A1')).toBe("'=cmd|/C calc!A1");
  });

  it('sanitizeCellForExcel prefixes + and - and @ characters', () => {
    expect(sanitizeCellForExcel('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(sanitizeCellForExcel('-1+2')).toBe("'-1+2");
    expect(sanitizeCellForExcel('@filter')).toBe("'@filter");
  });

  it('sanitizeCellForExcel leaves normal values unchanged', () => {
    expect(sanitizeCellForExcel('hello')).toBe('hello');
    expect(sanitizeCellForExcel(123)).toBe('123');
    expect(sanitizeCellForExcel(null)).toBe('');
    expect(sanitizeCellForExcel('')).toBe('');
  });
});

describe('QA-005: JournalEntriesView uses shared exportToCsv and explicit generate button', () => {
  it('JournalEntriesView imports exportToCsv from csvExport', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'JournalEntriesView.tsx'), 'utf-8');
    expect(content).toContain("from '../utils/csvExport'");
    expect(content).toContain('exportToCsv');
  });

  it('JournalEntriesView has a Generate / Refresh button', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'JournalEntriesView.tsx'), 'utf-8');
    expect(content).toContain('Generate / Refresh');
    expect(content).toContain('RefreshCw');
  });

  it('journal build uses shared calculatePresentValue for remeasurement', () => {
    const content = readFileSync(join(projectRoot, 'src', 'utils', 'leaseJournalBuild.ts'), 'utf-8');
    expect(content).toContain('calculatePresentValue');
    expect(content).not.toContain('for (let i = 0; i < remainingMonths; i++)');
  });

  it('journal hook reuses cached entries and only auto-generates when none exist', () => {
    const content = readFileSync(join(projectRoot, 'src', 'hooks', 'useLeaseJournal.ts'), 'utf-8');
    expect(content).not.toContain('loadJournalEntries()');
    expect(content).toMatch(/data = await loadLeaseJournal\(orgId, lease\.id\);/);
    expect(content).toMatch(/if \(data\.length === 0\) \{\s*runGenerate\(true\);\s*return;/);
    expect(content).toContain('setEntries(data as JournalEntry[]);');
  });
});

describe('SEC-014/025: Error reporter redaction', () => {
  it('errorReporter has expanded sensitive patterns', () => {
    const content = readFileSync(join(projectRoot, 'src', 'utils', 'errorReporter.ts'), 'utf-8');
    expect(content).toContain('bearer');
    expect(content).toContain('eyJ');
    expect(content).toContain('"password"');
    expect(content).toContain('"token"');
    expect(content).toContain('"secret"');
    expect(content).toContain('"key"');
    expect(content).toContain('[REDACTED_QUERY]');
  });
});

describe('QA-014 / F9: Document upload path uses uploader_id/uuid.ext', () => {
  it('DocumentsView no longer uses user.id/timestamp_filename pattern', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'DocumentsView.tsx'), 'utf-8');
    expect(content).not.toContain('${Date.now()}_${file.name}');
    expect(content).not.toContain('${user.id}/${fileName}');
  });

  it('DocumentsView uses crypto.randomUUID and the uploader id as the path prefix', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'DocumentsView.tsx'), 'utf-8');
    expect(content).toContain('crypto.randomUUID');
    expect(content).toContain('${user.id}/${fileId}.${safeExt}');
    expect(content).toContain('safeExt');
  });

  it('DocumentsView does not create storage buckets from the browser', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'DocumentsView.tsx'), 'utf-8');
    expect(content).not.toContain('createBucket');
  });

  it('DocumentsView keeps original file.name in file_name column', () => {
    const content = readFileSync(join(projectRoot, 'src', 'components', 'DocumentsView.tsx'), 'utf-8');
    expect(content).toContain('file_name: file.name');
  });
});

describe('SEC-008: Edge functions use the shared CORS allow-list', () => {
  const edgeFunctions = [
    'admin-update-user-password',
    'export-backup',
    'platform-admin-delete-user',
    'platform-admin-edit-user',
    'recreate-user',
    'remove-user',
    'reopen-month-end',
    'stripe-checkout',
  ];
  const shared = readFileSync(join(projectRoot, 'supabase', 'functions', '_shared', 'cors.ts'), 'utf-8');

  it('shared helper reads APP_ORIGINS and never echoes arbitrary origins', () => {
    expect(shared).toContain('APP_ORIGINS');
    expect(shared).toContain('isAllowedOrigin');
    expect(shared).not.toMatch(/origin \|\| "\*"/);
    expect(shared).not.toContain('"Access-Control-Allow-Origin": "*"');
  });

  for (const fn of edgeFunctions) {
    it(`${fn} imports the shared CORS helper and has no local origin logic`, () => {
      const content = readFileSync(join(projectRoot, 'supabase', 'functions', fn, 'index.ts'), 'utf-8');
      expect(content).toContain('../_shared/cors.ts');
      expect(content).toContain('preflightResponse(req)');
      expect(content).not.toContain('function getAllowedOrigin');
    });
  }

  it('stripe-webhook sends no CORS headers', () => {
    const content = readFileSync(join(projectRoot, 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf-8');
    expect(content).not.toContain('Access-Control-Allow-Origin');
  });
});

describe('QA-002: round2 throws on non-finite input', () => {
  it('round2 throws on NaN', () => {
    expect(() => round2(NaN)).toThrow('Non-finite');
  });

  it('round2 throws on Infinity', () => {
    expect(() => round2(Infinity)).toThrow('Non-finite');
  });

  it('round2 throws on -Infinity', () => {
    expect(() => round2(-Infinity)).toThrow('Non-finite');
  });

  it('round2 still works for finite values', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0)).toBe(0);
    expect(round2(123.456)).toBe(123.46);
  });
});

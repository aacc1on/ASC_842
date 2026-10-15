import { describe, it, expect } from 'vitest';
import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType, LeaseCostDisclosure } from '../financialReports';
import { EMPTY_MATURITY, type ClassificationRow } from './complianceCalculations';
import {
  buildExportData, buildExcelHtml, buildPdfHtml, classificationExportRows, escapeHtml, maturityExportRows, type ExportContext,
} from './complianceExport';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'l1', lease_name: 'Lease 1', lease_term_months: 36, incremental_borrowing_rate: 5, lease_classification: 'operating', payment_amount: 100, ...over,
} as unknown as Lease);

const tests = { transferOwnership: false, purchaseOptionReasonablyCertain: false, majorPartOfLife: false, substantiallyAllValue: true, specializedAsset: false };
const row = (over: Partial<ClassificationRow> = {}): ClassificationRow => ({
  lease: lease(), reassessedOn: null, pv: 1000.456, fv: 1100, termRatio: 0.5, pvRatio: 0.90949, purchaseRatio: null,
  classification: 'finance', reasons: [], tests, mismatch: true, ...over,
});

const labels = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'];
const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({
  periodStartDate: new Date(2026, 0, 1),
  periodEndDate: new Date(2026, 5, 30),
  activeLeaseCount: 3,
  generatedAt: new Date(2026, 6, 1, 12, 0),
  classificationRows: [row()],
  finance: [lease({ id: 'f', payment_amount: 250 })],
  operating: [],
  metrics: { watFinance: 1.5, watOperating: 0, wadrFinance: 4, wadrOperating: 0 },
  leaseBalancesByType: null,
  leaseCostDisclosure: null,
  bucketLabels: labels,
  maturityFinance: EMPTY_MATURITY,
  maturityOperating: EMPTY_MATURITY,
  qualitativeDisclosures: [{ ref: '842-20-50-3(a)', title: 'Nature', requirement: 'Req', available: true, findings: ['A.', 'B.'] }],
  ...over,
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });
});

describe('classificationExportRows', () => {
  it('formats ratios, PV/FV and status strings', () => {
    expect(classificationExportRows([row()])).toEqual([[
      'Lease 1', 36, '5.00', '1000.46', '1100.00', 'Not Met', 'Not Met', '50.0%', 'Not Met', '90.9%', 'Met', 'Not Met', 'Finance', 'Operating', 'Review',
    ]]);
  });

  it('uses N/A for missing ratios and annotates reassessed leases', () => {
    const [r] = classificationExportRows([row({ termRatio: null, pvRatio: null, reassessedOn: '2026-03-01', mismatch: false })]);
    expect(r[0]).toBe('Lease 1 (reassessed 2026-03-01)');
    expect(r.slice(7, 11)).toEqual(['N/A', 'N/A', 'N/A', 'N/A']);
    expect(r[14]).toBe('Aligned');
  });
});

describe('maturityExportRows', () => {
  it('lists five buckets, thereafter and the reconciliation', () => {
    const rows = maturityExportRows({ ...EMPTY_MATURITY, y1: 10, thereafter: 5, totalUndiscounted: 15, imputedInterest: 2, liabilitySum: 13 }, labels);
    expect(rows).toEqual([
      ['Y1', '10.00'], ['Y2', '0.00'], ['Y3', '0.00'], ['Y4', '0.00'], ['Y5', '0.00'], ['Thereafter', '5.00'],
      ['Total Undiscounted Lease Payments', '15.00'], ['Less: Imputed Interest', '(2.00)'], ['Present Value of Lease Liability', '13.00'],
    ]);
  });
});

describe('buildExportData', () => {
  it('builds the classification export with the reporting-period subtitle', () => {
    const c = ctx();
    const data = buildExportData('classification', c);
    expect(data.title).toBe('Lease Classification Test (ASC 842-10-25-2)');
    expect(data.subtitle).toBe(`Reporting period: ${c.periodStartDate.toLocaleDateString()} \u2013 ${c.periodEndDate.toLocaleDateString()} \u00b7 Active leases in period: 3 \u00b7 Generated: ${c.generatedAt.toLocaleString()}`);
    expect(data.tables).toHaveLength(1);
    expect(data.tables[0].headers).toHaveLength(15);
  });

  it('adds balance and cost tables to disclosures only when loaded', () => {
    expect(buildExportData('disclosures', ctx()).tables.map((t) => t.caption)).toEqual(['Weighted-Average Metrics', 'Summary by Classification']);
    const balances = {
      operatingGrossRou: 3, financeGrossRou: 5, operatingAccumulatedAmortization: 2, financeAccumulatedAmortization: 3, operatingImpairment: 0, financeImpairment: 0,
      operatingRouAsset: 1, financeRouAsset: 2, totalRouAsset: 3, operatingLiabilityCurrent: 1, financeLiabilityCurrent: 2, totalLiabilityCurrent: 3,
      operatingLiabilityNoncurrent: 4, financeLiabilityNoncurrent: 5, totalLiabilityNoncurrent: 9, totalLiability: 12,
    } as LeaseBalancesByType;
    const cost = {
      financeLeaseCost: 1, operatingLeaseCost: 2, shortTermLeaseCost: 3, variableLeaseCost: 0, subleaseIncome: 0, totalLeaseCost: 6,
      cashPaidOperatingLeases: 1, cashPaidFinanceInterest: 2, cashPaidFinancePrincipal: 3, rouObtainedOperating: 4, rouObtainedFinance: 5,
    } as LeaseCostDisclosure;
    const data = buildExportData('disclosures', ctx({ leaseBalancesByType: balances, leaseCostDisclosure: cost }));
    expect(data.tables.map((t) => t.caption)).toEqual([
      'Weighted-Average Metrics', 'Summary by Classification', 'Lease Balances by Type (ASC 842-20-45-1)', 'Lease Cost Components (ASC 842-20-50-4(a))', 'Other Information (ASC 842-20-50-4(g))',
    ]);
    expect(data.tables[0].rows[0]).toEqual(['Weighted-Avg Remaining Term — Finance', '1.50 years']);
    expect(data.tables[1].rows[0]).toEqual(['Finance', 1, '2.00', '7.00', '250.00', '1.50', '4.00']);
    expect(data.tables[2].rows[0]).toEqual(['ROU Assets (Gross)', '3.00', '5.00', '8.00']);
    expect(data.tables[2].rows[1]).toEqual(['Less: Accumulated amortization', '2.00', '3.00', '5.00']);
    expect(data.tables[2].rows[5]).toEqual(['Total Lease Liabilities', '5.00', '7.00', '12.00']);
    expect(data.tables[3].rows[5]).toEqual(['Total Lease Cost', '6.00']);
  });

  it('builds maturity tables for finance and operating', () => {
    const data = buildExportData('maturity', ctx());
    expect(data.title).toBe('Maturity Analysis (ASC 842-20-50-6)');
    expect(data.tables.map((t) => t.caption)).toEqual(['Finance Leases', 'Operating Leases']);
  });

  it('falls back to the checklist export for checklist (and any other section)', () => {
    for (const s of ['checklist', 'reconciliation'] as const) {
      const data = buildExportData(s, ctx());
      expect(data.title).toBe('Qualitative Disclosure Checklist (ASC 842-20-50)');
      expect(data.tables[0].rows).toEqual([['ASC 842-20-50-3(a)', 'Nature', 'Req', 'A. B.', 'Data available']]);
    }
  });
});

describe('HTML builders', () => {
  const data = { title: 'T & C', subtitle: 'sub', tables: [{ caption: 'Cap', headers: ['H<1>'], rows: [['v', 2]] }] };

  it('builds Excel-compatible HTML with escaped content', () => {
    const html = buildExcelHtml(data);
    expect(html.startsWith('<html xmlns:o="urn:schemas-microsoft-com:office:office"')).toBe(true);
    expect(html).toContain('<h2 style="font-family:Arial;">T &amp; C</h2>');
    expect(html).toContain('<th>H&lt;1&gt;</th>');
    expect(html).toContain('<tr><td>v</td><td>2</td></tr>');
  });

  it('builds a printable PDF document', () => {
    const html = buildPdfHtml(data);
    expect(html.startsWith('<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>T &amp; C</title>')).toBe(true);
    expect(html).toContain('<div class="meta">sub</div>');
    expect(html).toContain('Prepared in accordance with FASB ASC Topic 842 (Leases).');
  });
});

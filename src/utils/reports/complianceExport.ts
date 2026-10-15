import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType, LeaseCostDisclosure, MaturityResult } from '../financialReports';
import { getLeaseDiscountRate } from '../discountRate';
import { classTotals, sumPayments, type ClassificationRow, type WeightedMetrics } from './complianceCalculations';
import type { DisclosureItem } from './complianceDisclosures';

export type ExportSection = 'classification' | 'disclosures' | 'maturity' | 'checklist' | 'reconciliation';

export interface ExportTable { caption: string; headers: string[]; rows: (string | number)[][] }
export interface ExportData { title: string; subtitle: string; tables: ExportTable[] }

export interface ExportContext {
  periodStartDate: Date;
  periodEndDate: Date;
  activeLeaseCount: number;
  generatedAt: Date;
  classificationRows: ClassificationRow[];
  finance: Lease[];
  operating: Lease[];
  metrics: WeightedMetrics;
  leaseBalancesByType: LeaseBalancesByType | null;
  leaseCostDisclosure: LeaseCostDisclosure | null;
  bucketLabels: string[];
  maturityFinance: MaturityResult;
  maturityOperating: MaturityResult;
  qualitativeDisclosures: DisclosureItem[];
}

export function classificationExportRows(classificationRows: ClassificationRow[]): (string | number)[][] {
  return classificationRows.map((r) => [
    r.reassessedOn ? `${r.lease.lease_name} (reassessed ${r.reassessedOn})` : r.lease.lease_name,
    Number(r.lease.lease_term_months) || 0,
    (getLeaseDiscountRate(r.lease) || 0).toFixed(2),
    r.pv.toFixed(2),
    r.fv.toFixed(2),
    r.tests.transferOwnership ? 'Met' : 'Not Met',
    r.tests.purchaseOptionReasonablyCertain ? 'Met' : (!r.lease.purchase_option ? 'Not Met' : 'Not Met'),
    r.termRatio === null ? 'N/A' : `${(r.termRatio * 100).toFixed(1)}%`,
    r.termRatio === null ? 'N/A' : (r.tests.majorPartOfLife ? 'Met' : 'Not Met'),
    r.pvRatio === null ? 'N/A' : `${(Math.trunc(r.pvRatio * 1000) / 10).toFixed(1)}%`,
    r.pvRatio === null ? 'N/A' : (r.tests.substantiallyAllValue ? 'Met' : 'Not Met'),
    r.tests.specializedAsset ? 'Met' : 'Not Met',
    r.classification === 'finance' ? 'Finance' : 'Operating',
    r.lease.lease_classification === 'finance' ? 'Finance' : 'Operating',
    r.mismatch ? 'Review' : 'Aligned',
  ]);
}

export function maturityExportRows(m: MaturityResult, bucketLabels: string[]): (string | number)[][] {
  return [
    [bucketLabels[0], m.y1.toFixed(2)],
    [bucketLabels[1], m.y2.toFixed(2)],
    [bucketLabels[2], m.y3.toFixed(2)],
    [bucketLabels[3], m.y4.toFixed(2)],
    [bucketLabels[4], m.y5.toFixed(2)],
    ['Thereafter', m.thereafter.toFixed(2)],
    ['Total Undiscounted Lease Payments', m.totalUndiscounted.toFixed(2)],
    ['Less: Imputed Interest', `(${m.imputedInterest.toFixed(2)})`],
    ['Present Value of Lease Liability', m.liabilitySum.toFixed(2)],
  ];
}

function disclosureTables(ctx: ExportContext): ExportTable[] {
  const { finance, operating, leaseBalancesByType, leaseCostDisclosure } = ctx;
  const { watFinance, watOperating, wadrFinance, wadrOperating } = ctx.metrics;
  const summaryRows: (string | number)[][] = [
    ['Weighted-Avg Remaining Term — Finance', `${watFinance.toFixed(2)} years`],
    ['Weighted-Avg Remaining Term — Operating', `${watOperating.toFixed(2)} years`],
    ['Weighted-Avg Discount Rate — Finance', `${wadrFinance.toFixed(2)}%`],
    ['Weighted-Avg Discount Rate — Operating', `${wadrOperating.toFixed(2)}%`],
  ];
  const detailHeaders = ['Classification', 'Leases', 'Total ROU Asset', 'Total Lease Liability', 'Monthly Payments', 'Wtd Avg Term (yrs)', 'Wtd Avg Rate (%)'];
  const fin = classTotals(leaseBalancesByType, 'finance');
  const op = classTotals(leaseBalancesByType, 'operating');
  const detailRows = [
    ['Finance', finance.length, fin.rou.toFixed(2), fin.liab.toFixed(2), sumPayments(finance).toFixed(2), watFinance.toFixed(2), wadrFinance.toFixed(2)],
    ['Operating', operating.length, op.rou.toFixed(2), op.liab.toFixed(2), sumPayments(operating).toFixed(2), watOperating.toFixed(2), wadrOperating.toFixed(2)],
  ];
  const tables: ExportTable[] = [
    { caption: 'Weighted-Average Metrics', headers: ['Metric', 'Value'], rows: summaryRows },
    { caption: 'Summary by Classification', headers: detailHeaders, rows: detailRows },
  ];
  if (leaseBalancesByType) {
    const b = leaseBalancesByType;
    tables.push({
      caption: 'Lease Balances by Type (ASC 842-20-45-1)',
      headers: ['Balance', 'Operating', 'Finance', 'Total'],
      rows: [
        ['ROU Assets (Gross)', b.operatingGrossRou.toFixed(2), b.financeGrossRou.toFixed(2), (b.operatingGrossRou + b.financeGrossRou).toFixed(2)],
        ['Less: Accumulated amortization', b.operatingAccumulatedAmortization.toFixed(2), b.financeAccumulatedAmortization.toFixed(2), (b.operatingAccumulatedAmortization + b.financeAccumulatedAmortization).toFixed(2)],
        ...(b.operatingImpairment + b.financeImpairment > 0
          ? [['Less: Accumulated impairment', b.operatingImpairment.toFixed(2), b.financeImpairment.toFixed(2), (b.operatingImpairment + b.financeImpairment).toFixed(2)]]
          : []),
        ['ROU Assets', b.operatingRouAsset.toFixed(2), b.financeRouAsset.toFixed(2), b.totalRouAsset.toFixed(2)],
        ['Current Liabilities', b.operatingLiabilityCurrent.toFixed(2), b.financeLiabilityCurrent.toFixed(2), b.totalLiabilityCurrent.toFixed(2)],
        ['Noncurrent Liabilities', b.operatingLiabilityNoncurrent.toFixed(2), b.financeLiabilityNoncurrent.toFixed(2), b.totalLiabilityNoncurrent.toFixed(2)],
        ['Total Lease Liabilities', (b.operatingLiabilityCurrent + b.operatingLiabilityNoncurrent).toFixed(2), (b.financeLiabilityCurrent + b.financeLiabilityNoncurrent).toFixed(2), b.totalLiability.toFixed(2)],
      ],
    });
  }
  if (leaseCostDisclosure) {
    const c = leaseCostDisclosure;
    tables.push({
      caption: 'Lease Cost Components (ASC 842-20-50-4(a))',
      headers: ['Component', 'Amount'],
      rows: [
        ['Finance Lease Cost (amortization + interest)', c.financeLeaseCost.toFixed(2)],
        ['Operating Lease Cost', c.operatingLeaseCost.toFixed(2)],
        ['Short-Term Lease Cost', c.shortTermLeaseCost.toFixed(2)],
        ['Variable Lease Cost', c.variableLeaseCost.toFixed(2)],
        ['Sublease Income', c.subleaseIncome.toFixed(2)],
        ['Total Lease Cost', c.totalLeaseCost.toFixed(2)],
      ],
    }, {
      caption: 'Other Information (ASC 842-20-50-4(g))',
      headers: ['Item', 'Amount'],
      rows: [
        ['Cash Paid — Operating Leases (operating)', c.cashPaidOperatingLeases.toFixed(2)],
        ['Cash Paid — Finance Interest (operating)', c.cashPaidFinanceInterest.toFixed(2)],
        ['Cash Paid — Finance Principal (financing)', c.cashPaidFinancePrincipal.toFixed(2)],
        ['ROU Obtained — Operating Leases', c.rouObtainedOperating.toFixed(2)],
        ['ROU Obtained — Finance Leases', c.rouObtainedFinance.toFixed(2)],
      ],
    });
  }
  return tables;
}

export function buildExportData(section: ExportSection, ctx: ExportContext): ExportData {
  const meta = `Reporting period: ${ctx.periodStartDate.toLocaleDateString()} \u2013 ${ctx.periodEndDate.toLocaleDateString()} \u00b7 Active leases in period: ${ctx.activeLeaseCount} \u00b7 Generated: ${ctx.generatedAt.toLocaleString()}`;
  if (section === 'classification') {
    const headers = ['Lease', 'Term (mo)', 'IBR (%)', 'PV of Payments', 'Asset Fair Value', 'Transfer of Ownership', 'Purchase Option (Reasonably Certain)', 'Term % of Life', 'Major Part of Life (>=75%)', 'PV % of FV', 'Substantially All FV (>=90%)', 'Specialized Asset', 'System Result', 'Recorded', 'Status'];
    return {
      title: 'Lease Classification Test (ASC 842-10-25-2)',
      subtitle: meta,
      tables: [{ caption: 'Classification Test Results', headers, rows: classificationExportRows(ctx.classificationRows) }],
    };
  }
  if (section === 'disclosures') {
    return { title: 'Quantitative Disclosures (ASC 842-20-50-4)', subtitle: meta, tables: disclosureTables(ctx) };
  }
  if (section === 'maturity') {
    return {
      title: 'Maturity Analysis (ASC 842-20-50-6)',
      subtitle: meta,
      tables: [
        { caption: 'Finance Leases', headers: ['Period', 'Amount (USD)'], rows: maturityExportRows(ctx.maturityFinance, ctx.bucketLabels) },
        { caption: 'Operating Leases', headers: ['Period', 'Amount (USD)'], rows: maturityExportRows(ctx.maturityOperating, ctx.bucketLabels) },
      ],
    };
  }
  return {
    title: 'Qualitative Disclosure Checklist (ASC 842-20-50)',
    subtitle: meta,
    tables: [{
      caption: 'Required Disclosures with Reported Information',
      headers: ['ASC Reference', 'Disclosure Area', 'Requirement', 'Reported Information', 'Status'],
      rows: ctx.qualitativeDisclosures.map((d) => [
        `ASC ${d.ref}`,
        d.title,
        d.requirement,
        d.findings.join(' '),
        d.available ? 'Data available' : 'Narrative required',
      ]),
    }],
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function buildExcelHtml(data: ExportData): string {
  const tablesHtml = data.tables.map((t) => `
      <h3 style="font-family:Arial;font-size:14px;margin:16px 0 6px;">${escapeHtml(t.caption)}</h3>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:12px;">
        <thead>
          <tr style="background:#1e3a8a;color:#fff;">
            ${t.headers.map((h) => `<th>${escapeHtml(String(h))}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"/></head><body><h2 style="font-family:Arial;">${escapeHtml(data.title)}</h2><div style="font-family:Arial;font-size:11px;color:#555;">${escapeHtml(data.subtitle)}</div>${tablesHtml}</body></html>`;
}

export function buildPdfHtml(data: ExportData): string {
  const tablesHtml = data.tables.map((t) => `
      <h3>${escapeHtml(t.caption)}</h3>
      <table>
        <thead>
          <tr>${t.headers.map((h) => `<th>${escapeHtml(String(h))}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${escapeHtml(data.title)}</title>
      <style>
        @page { size: A4 landscape; margin: 14mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { font-family: 'Helvetica', 'Arial', sans-serif; color: #0f172a; padding: 16px; }
        h1 { font-size: 18px; margin: 0 0 4px; color: #1e3a8a; }
        .meta { font-size: 10px; color: #64748b; margin-bottom: 16px; }
        h3 { font-size: 13px; margin: 18px 0 6px; color: #0f172a; border-bottom: 2px solid #1e3a8a; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 12px; }
        th { background: #1e3a8a; color: #fff; text-align: left; padding: 6px 8px; font-weight: 700; }
        td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) td { background: #f8fafc; }
        .footer { margin-top: 24px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      </style></head><body>
      <h1>${escapeHtml(data.title)}</h1>
      <div class="meta">${escapeHtml(data.subtitle)}</div>
      ${tablesHtml}
      <div class="footer">Prepared in accordance with FASB ASC Topic 842 (Leases). For internal review purposes.</div>
      </body></html>`;
}

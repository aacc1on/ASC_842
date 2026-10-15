import { useState } from 'react';
import { UnpostedMonthEndBanner } from '../../UnpostedMonthEndBanner';
import { type ComplianceSection } from '../types';
import { type Lease } from '../../../types/lease';
import { LoadError } from '../../LoadError';
import { useComplianceData } from '../../../hooks/reports/useComplianceData';
import {
  toIso, presetRange, resolveReportDates, buildClassificationRows, splitByClassification,
  computeWeightedMetrics, maturityBucketLabels, EMPTY_MATURITY, type PeriodPreset,
} from '../../../utils/reports/complianceCalculations';
import { buildQualitativeDisclosures } from '../../../utils/reports/complianceDisclosures';
import { buildExportData, buildExcelHtml, buildPdfHtml } from '../../../utils/reports/complianceExport';
import { downloadExcelFile, printHtmlInFrame } from './complianceDownloads';
import { ClassificationTest } from './ClassificationTest';
import { QuantitativeDisclosures } from './QuantitativeDisclosures';
import { MaturityAnalysis } from './MaturityAnalysis';
import { DisclosureChecklist } from './DisclosureChecklist';
import { LedgerReconciliation } from './LedgerReconciliation';
import { BarChart3, Download, Calendar, ShieldCheck, ClipboardCheck, Scale, BookOpen } from 'lucide-react';

interface ComplianceReportsProps {
  leases: Lease[];
  activeSection: ComplianceSection;
  onChangeSection: (s: ComplianceSection) => void;
  onEditLease: (lease: Lease) => void;
  onViewLease: (lease: Lease) => void;
  selectedCompanyId?: string | null;
}

const SECTIONS: { key: ComplianceSection; label: string; Icon: typeof ShieldCheck; cite: string }[] = [
  { key: 'classification', label: 'Classification Test', Icon: Scale, cite: 'ASC 842-10-25-2' },
  { key: 'disclosures', label: 'Quantitative Disclosures', Icon: BarChart3, cite: 'ASC 842-20-50-4' },
  { key: 'maturity', label: 'Maturity Analysis', Icon: Calendar, cite: 'ASC 842-20-50-6' },
  { key: 'checklist', label: 'Disclosure Checklist', Icon: ClipboardCheck, cite: 'ASC 842-20-50' },
  { key: 'reconciliation', label: 'Ledger reconciliation', Icon: BookOpen, cite: 'Locked months' },
];

const PRESETS = [
  ['ytd', 'YTD'],
  ['q1', 'Q1'],
  ['q2', 'Q2'],
  ['q3', 'Q3'],
  ['q4', 'Q4'],
  ['fy', 'FY'],
  ['lastFy', 'Last FY'],
] as const;

export function ComplianceReports({ leases, activeSection, onChangeSection, onEditLease, onViewLease, selectedCompanyId }: ComplianceReportsProps) {
  const now = new Date();
  const [periodStart, setPeriodStart] = useState<string>(() => toIso(new Date(now.getFullYear(), 0, 1)));
  const [periodEnd, setPeriodEnd] = useState<string>(() => toIso(now));
  const {
    activeLeases, reassessments, leaseCostDisclosure, leaseBalancesByType, remainingLiabilityMap, maturity,
    error: loadError, retry,
  } = useComplianceData(leases, periodStart, periodEnd);

  const { periodStartDate, periodEndDate, today } = resolveReportDates(periodStart, periodEnd);

  const applyPreset = (preset: PeriodPreset) => {
    const range = presetRange(preset, now);
    if (!range) return;
    setPeriodStart(toIso(range[0]));
    setPeriodEnd(toIso(range[1]));
  };

  const classificationRows = buildClassificationRows(activeLeases, reassessments);
  const { finance, operating } = splitByClassification(activeLeases);
  const metrics = computeWeightedMetrics(finance, operating, remainingLiabilityMap, today);
  const maturityFinance = maturity?.finance ?? EMPTY_MATURITY;
  const maturityOperating = maturity?.operating ?? EMPTY_MATURITY;
  const bucketLabels = maturityBucketLabels(today);
  const qualitativeDisclosures = buildQualitativeDisclosures({
    activeLeases, finance, operating, today, metrics, leaseCostDisclosure, leaseBalancesByType, maturityFinance, maturityOperating,
  });

  const exportData = () => buildExportData(activeSection, {
    periodStartDate,
    periodEndDate,
    activeLeaseCount: activeLeases.length,
    generatedAt: new Date(),
    classificationRows,
    finance,
    operating,
    metrics,
    leaseBalancesByType,
    leaseCostDisclosure,
    bucketLabels,
    maturityFinance,
    maturityOperating,
    qualitativeDisclosures,
  });

  const handleDownloadExcel = () => {
    const html = buildExcelHtml(exportData());
    downloadExcelFile(html, `compliance-${activeSection}-${new Date().toISOString().split('T')[0]}.xls`);
  };

  const handleDownloadPdf = () => {
    printHtmlInFrame(buildPdfHtml(exportData()));
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 border border-blue-100 rounded-2xl p-5 flex items-start gap-4">
        <div className="bg-blue-600 text-white p-3 rounded-xl shadow-sm">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-900">ASC 842 Compliance Center</h3>
          <p className="text-sm text-slate-600 mt-1">
            Built to FASB ASC Topic 842 (Leases). Reports cover lessee classification criteria,
            quantitative disclosures, maturity reconciliation, and qualitative disclosure tracking.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-slate-500 uppercase">Active Leases</div>
          <div className="text-2xl font-bold text-slate-900">{activeLeases.length}</div>
        </div>
      </div>

      {loadError && <LoadError message={loadError} onRetry={retry} />}

      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 mr-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-bold text-slate-900">Reporting Period</span>
        </div>
        <div className="flex flex-col">
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">From</label>
          <input
            type="date"
            value={periodStart}
            max={periodEnd}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">To</label>
          <input
            type="date"
            value={periodEnd}
            min={periodStart}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-xs font-semibold text-slate-700 transition"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{activeLeases.length}</span> lease{activeLeases.length === 1 ? '' : 's'} active during period
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
        {SECTIONS.map(({ key, label, Icon, cite }) => {
          const isActive = activeSection === key;
          return (
            <button
              key={key}
              onClick={() => onChangeSection(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition ${
                isActive
                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{cite}</span>
            </button>
          );
        })}
        </div>
        {activeSection !== 'reconciliation' && <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadExcel}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition"
            title="Download current section as Excel"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition"
            title="Download current section as PDF (uses browser print dialog)"
          >
            <Download className="w-4 h-4" />
            PDF
          </button>
        </div>}
      </div>

      <UnpostedMonthEndBanner leases={activeLeases} asOf={periodEnd} />

      {activeSection === 'reconciliation' && <LedgerReconciliation />}

      {activeSection === 'classification' && (
        <ClassificationTest
          rows={classificationRows}
          activeLeaseCount={activeLeases.length}
          onEditLease={onEditLease}
          onViewLease={onViewLease}
        />
      )}

      {activeSection === 'disclosures' && (
        <QuantitativeDisclosures
          finance={finance}
          operating={operating}
          metrics={metrics}
          leaseBalancesByType={leaseBalancesByType}
          periodEnd={periodEnd}
        />
      )}

      {activeSection === 'maturity' && (
        <MaturityAnalysis
          maturityFinance={maturityFinance}
          maturityOperating={maturityOperating}
          bucketLabels={bucketLabels}
          finance={finance}
          operating={operating}
        />
      )}

      {activeSection === 'checklist' && (
        <DisclosureChecklist
          disclosures={qualitativeDisclosures}
          selectedCompanyId={selectedCompanyId}
          periodEnd={periodEnd}
        />
      )}
    </div>
  );
}

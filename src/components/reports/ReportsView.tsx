import { useMemo, useState } from 'react';
import { BreakdownPanel } from '../BreakdownPanel';
import { LeaseForm } from '../LeaseForm';
import { useFinancialReportsData } from '../../hooks/reports/useFinancialReportsData';
import { useReportsBaseData } from '../../hooks/reports/useReportsBaseData';
import { LoadError } from '../LoadError';
import { useTransactionsByAssetData } from '../../hooks/reports/useTransactionsByAssetData';
import { type Lease } from '../../types/lease';
import { computePeriodBounds, initialPeriodSelection } from '../../utils/reports/period';
import { DEFAULT_PORTFOLIO_VIEW, DEFAULT_REPORT_FILTERS, filterLeases } from '../../utils/reports/portfolio';
import { ComplianceReports } from './Compliance/ComplianceReports';
import { ContractExpirationReport } from './ContractExpiration/ContractExpirationReport';
import { FinancialReports } from './FinancialReports';
import { PaymentReminderReport } from './PaymentReminders/PaymentReminderReport';
import { PortfolioOverview } from './PortfolioOverview/PortfolioOverview';
import { BreakdownContext } from './shared/breakdownContext';
import { LeaseDetailModal } from './shared/LeaseDetailModal';
import { ReportsHeader } from './shared/ReportsHeader';
import { type ActiveBreakdown, type ComplianceSection, type FinancialReportKind, type ReportsTab } from './types';

interface ReportsViewProps {
  onClose?: () => void;
  selectedCompanyId?: string | null;
}

export function ReportsView({ onClose, selectedCompanyId }: ReportsViewProps) {
  const { leases, report, loading, error, userId, branchOptions, assetTypeOptions, reload } = useReportsBaseData(selectedCompanyId);
  const [activeTab, setActiveTab] = useState<ReportsTab>('portfolio');
  const [complianceSection, setComplianceSection] = useState<ComplianceSection>('classification');
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [viewingLease, setViewingLease] = useState<Lease | null>(null);
  const [activeBreakdown, setActiveBreakdown] = useState<ActiveBreakdown | null>(null);
  const [period, setPeriod] = useState(() => initialPeriodSelection(new Date()));
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS);
  const [selectedReport, setSelectedReport] = useState<FinancialReportKind>('balance_sheet');
  const [portfolioView, setPortfolioView] = useState(DEFAULT_PORTFOLIO_VIEW);

  const { start: periodStart, end: periodEnd } = computePeriodBounds(period);
  const filteredLeases = useMemo(() => filterLeases(leases, filters), [leases, filters]);

  const financial = useFinancialReportsData({
    active: activeTab === 'financial',
    leases,
    filteredLeases,
    periodMode: period.mode,
    periodStart,
    periodEnd,
    branchOptions,
    assetTypeOptions,
  });
  const assets = useTransactionsByAssetData({
    active: activeTab === 'financial' && selectedReport === 'transaction_by_assets',
    filteredLeases,
    periodStart,
    periodEnd,
  });

  if (error) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="sr-only">Reports</h1>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  if (loading || !report) {
    return (
      <div className="p-8 flex items-center justify-center">
        <h1 className="sr-only">Reports</h1>
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-slate-500 mt-4">Loading reports...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <h1 className="sr-only">Reports</h1>
      {activeBreakdown && (
        <BreakdownPanel
          title={activeBreakdown.title}
          total={activeBreakdown.total}
          items={activeBreakdown.items}
          isNegative={activeBreakdown.isNegative}
          onClose={() => setActiveBreakdown(null)}
        />
      )}

      {editingLease && userId && (
        <LeaseForm
          lease={editingLease}
          userId={userId}
          onClose={() => setEditingLease(null)}
          onSuccess={() => {
            setEditingLease(null);
            reload();
          }}
        />
      )}

      {viewingLease && (
        <LeaseDetailModal lease={viewingLease} onClose={() => setViewingLease(null)} onEdit={() => { setEditingLease(viewingLease); setViewingLease(null); }} />
      )}

      <div className="bg-white rounded-xl shadow-lg max-w-7xl mx-auto overflow-hidden flex flex-col">
        <ReportsHeader onClose={onClose} activeTab={activeTab} setActiveTab={setActiveTab} />

        <BreakdownContext.Provider value={setActiveBreakdown}>
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'portfolio' && (
            <PortfolioOverview report={report} leases={leases} view={portfolioView} onViewChange={setPortfolioView} />
          )}

          {activeTab === 'financial' && (
            <FinancialReports
              leases={leases}
              filteredLeases={filteredLeases}
              branchOptions={branchOptions}
              assetTypeOptions={assetTypeOptions}
              filters={filters}
              onFiltersChange={setFilters}
              period={period}
              onPeriodChange={setPeriod}
              periodStart={periodStart}
              periodEnd={periodEnd}
              selectedReport={selectedReport}
              setSelectedReport={setSelectedReport}
              financial={financial}
              assets={assets}
            />
          )}

          {activeTab === 'compliance' && (
            <ComplianceReports
              leases={filteredLeases}
              activeSection={complianceSection}
              onChangeSection={setComplianceSection}
              onEditLease={setEditingLease}
              onViewLease={setViewingLease}
              selectedCompanyId={selectedCompanyId}
            />
          )}

          {activeTab === 'expiration' && (
            <ContractExpirationReport leases={filteredLeases} />
          )}

          {activeTab === 'payment_reminder' && (
            <PaymentReminderReport leases={filteredLeases} />
          )}
        </div>
        </BreakdownContext.Provider>
      </div>
    </div>
  );
}

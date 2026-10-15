import { UnpostedMonthEndBanner } from '../UnpostedMonthEndBanner';
import { type BranchOption, type AssetTypeOption, type FinancialReportKind } from './types';
import { type Lease } from '../../types/lease';

import { type FinancialReportsData } from '../../hooks/reports/useFinancialReportsData';
import { type TransactionsByAssetData } from '../../hooks/reports/useTransactionsByAssetData';
import { type PeriodSelection } from '../../utils/reports/period';
import { type ReportFilterState } from '../../utils/reports/portfolio';
import { LeaseBalancesByTypeTable } from './BalanceSheet/LeaseBalancesByTypeTable';
import { BalanceSheetReport } from './BalanceSheet/BalanceSheetReport';
import { CashFlowReport } from './CashFlow/CashFlowReport';
import { ProfitLossReport } from './ProfitAndLoss/ProfitLossReport';
import { PeriodFilter } from './shared/PeriodFilter';
import { ReportFilters } from './shared/ReportFilters';
import { TransactionLedgerReport } from './TransactionLedger/TransactionLedgerReport';
import { TransactionsByAssetReport } from './TransactionsByAsset/TransactionsByAssetReport';

interface FinancialReportsProps {
  leases: Lease[];
  filteredLeases: Lease[];
  branchOptions: BranchOption[];
  assetTypeOptions: AssetTypeOption[];
  filters: ReportFilterState;
  onFiltersChange: (f: ReportFilterState) => void;
  period: PeriodSelection;
  onPeriodChange: (p: PeriodSelection) => void;
  periodStart: string;
  periodEnd: string;
  selectedReport: FinancialReportKind;
  setSelectedReport: (r: FinancialReportKind) => void;
  financial: FinancialReportsData;
  assets: TransactionsByAssetData;
}

export function FinancialReports({
  leases,
  filteredLeases,
  branchOptions,
  assetTypeOptions,
  filters,
  onFiltersChange,
  period,
  onPeriodChange,
  periodStart,
  periodEnd,
  selectedReport,
  setSelectedReport,
  financial,
  assets,
}: FinancialReportsProps) {
  const { balanceSheet, balancesByType, profitLoss, cashFlow } = financial;
  return (
    <div className="space-y-6">
      <UnpostedMonthEndBanner leases={filteredLeases} asOf={periodEnd} />
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Select Report</label>
          <select
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value as typeof selectedReport)}
            className="w-full md:w-72 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm"
          >
            <option value="balance_sheet">Balance Sheet</option>
            <option value="profit_loss">Profit &amp; Loss Statement</option>
            <option value="cash_flow">Cash Flow Statement</option>
            <option value="transaction_ledger">Transaction Ledger</option>
            <option value="transaction_by_assets">Transaction by Assets</option>
          </select>
        </div>

        <PeriodFilter period={period} onChange={onPeriodChange} />
      </div>

      <ReportFilters leases={leases} branchOptions={branchOptions} assetTypeOptions={assetTypeOptions} filters={filters} onChange={onFiltersChange} />

      <p className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400"></span>
          Click any amount to see a per-lease breakdown
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-600">
          Showing <span className="font-bold text-slate-900">{filteredLeases.length}</span> of {leases.length} leases
        </span>
      </p>

      {filteredLeases.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-sm font-semibold text-amber-900">No leases match the selected filters.</p>
          <p className="text-xs text-amber-700 mt-1">Adjust the Fixed Asset Type or Branch filter to see results.</p>
        </div>
      )}

      {selectedReport === 'balance_sheet' && balanceSheet && <BalanceSheetReport balanceSheet={balanceSheet} periodEnd={periodEnd} />}
      {selectedReport === 'balance_sheet' && balancesByType && <LeaseBalancesByTypeTable balancesByType={balancesByType} />}
      {selectedReport === 'profit_loss' && profitLoss && <ProfitLossReport {...financial} profitLoss={profitLoss} />}
      {selectedReport === 'cash_flow' && cashFlow && <CashFlowReport {...financial} cashFlow={cashFlow} />}
      {selectedReport === 'transaction_ledger' && (
        <TransactionLedgerReport
          periodStart={periodStart}
          periodEnd={periodEnd}
          detailedLedger={financial.detailedLedger}
          ledgerPage={financial.ledgerPage}
          ledgerPageSize={financial.ledgerPageSize}
          setLedgerPage={financial.setLedgerPage}
          setLedgerPageSize={financial.setLedgerPageSize}
          weekReports={financial.weekReports}
          monthReports={financial.monthReports}
        />
      )}
      {selectedReport === 'transaction_by_assets' && <TransactionsByAssetReport periodStart={periodStart} periodEnd={periodEnd} {...assets} />}
    </div>
  );
}

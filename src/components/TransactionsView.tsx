import { useState, useEffect, useCallback } from 'react';
import { Receipt, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from './toastContextTypes';
import type { UserRole, UserPermissions } from '../App';
import { isServerViewMode, type TransactionsViewProps, type ViewMode } from './transactions/types';
import { useTransactionsData } from '../hooks/useTransactionsData';
import { LoadError } from './LoadError';
import { useTransactionForm } from '../hooks/useTransactionForm';
import { useTransactionFilterState, useTransactionFilters } from '../hooks/useTransactionFilters';
import { useTransactionSummary } from '../hooks/useTransactionSummary';
import { useWeeklyGroups } from '../hooks/useWeeklyGroups';
import { useMonthEnd } from '../hooks/useMonthEnd';
import { useTransactionMutations } from '../hooks/useTransactionMutations';
import { downloadExcel } from '../utils/exportTransactionsExcel';
import { TransactionsHeader } from './transactions/TransactionsHeader';
import { TransactionFilters as TransactionFiltersPanel } from './transactions/TransactionFilters';
import { TransactionSummaryCards } from './transactions/TransactionSummaryCards';
import { DebitsByAccountTable } from './transactions/DebitsByAccountTable';
import { CreditsByAccountTable } from './transactions/CreditsByAccountTable';
import { WeeklyTransactionsView } from './transactions/WeeklyTransactionsView';
import { TransactionGridView } from './transactions/TransactionGridView';
import { TransactionTableView } from './transactions/TransactionTableView';
import { ALL_PAGE_SIZE } from './Pagination';
import { TransactionKanbanView } from './transactions/TransactionKanbanView';
import { AddTransactionModal } from './transactions/AddTransactionModal';
import { TransactionDetailsModal } from './transactions/TransactionDetailsModal';
import { MonthEndModal } from './transactions/MonthEndModal';
import { AccountBreakdownModal } from './transactions/AccountBreakdownModal';
import { TransactionListControls } from './transactions/TransactionListControls';

const PAGE_SIZE_OPTIONS = [25, 50, 100, ALL_PAGE_SIZE];

export function TransactionsView({ permissions, selectedCompanyId }: TransactionsViewProps) {
  const { confirm: confirmDialog } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [debitAcctPage, setDebitAcctPage] = useState(1);
  const [creditAcctPage, setCreditAcctPage] = useState(1);
  const [breakdownModal, setBreakdownModal] = useState<{ side: 'debit' | 'credit'; account: string } | null>(null);
  const acctPageSize = 10;

  const {
    showAddModal,
    setShowAddModal,
    selectedTransaction,
    setSelectedTransaction,
    formData,
    setFormData,
    resetForm,
  } = useTransactionForm();

  const filterState = useTransactionFilterState();
  const {
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterPeriod,
    setFilterPeriod,
    filterFixedAssetType,
    setFilterFixedAssetType,
    filterBranch,
    setFilterBranch,
    filterLeaseClassification,
    setFilterLeaseClassification,
    customPeriodStart,
    setCustomPeriodStart,
    customPeriodEnd,
    setCustomPeriodEnd,
  } = filterState;

  const dataFilters = {
    currentPage,
    pageSize,
    debouncedSearch: filterState.debouncedSearch,
    filterType,
    filterPeriod,
    customPeriodStart,
    customPeriodEnd,
    filterFixedAssetType,
    filterBranch,
    filterLeaseClassification,
  };

  const {
    transactions,
    serverRows,
    serverTotalCount,
    leases,
    branches,
    loading,
    error: loadError,
    refreshData,
  } = useTransactionsData(viewMode, dataFilters, selectedCompanyId);

  // Compute filter-derived values (unique periods, asset types, filtered set)
  // from the loaded transactions using the same filter state.
  const {
    uniquePeriods,
    uniqueFixedAssetTypes,
    filteredTransactions,
  } = useTransactionFilters(transactions, filterState);

  const {
    totalDebits,
    totalCredits,
    debitAccountSummary,
    creditAccountSummary,
    activeBranches,
    debitByAccountAndBranch,
    creditByAccountAndBranch,
  } = useTransactionSummary(filteredTransactions);

  const serverMode = isServerViewMode(viewMode);
  const effectiveCount = serverMode ? serverTotalCount : filteredTransactions.length;

  const {
    weeklyGroups,
    expandedWeeks,
    expandedSections,
    toggleWeek,
    toggleSection,
  } = useWeeklyGroups(filteredTransactions);

  const {
    submitting,
    successMessage,
    setSuccessMessage,
    errorMessage,
    setErrorMessage,
    handleSubmit,
    handleReverseTransaction,
    handleDeleteTransaction,
  } = useTransactionMutations({
    confirmDialog,
    refreshData,
    resetForm,
    setShowAddModal,
    setSelectedTransaction,
  });

  const monthEnd = useMonthEnd({
    leases,
    transactions,
    refreshData,
    setSuccessMessage,
    setErrorMessage,
    confirmDialog: { confirm: confirmDialog },
  });

  useEffect(() => {
    setCurrentPage(1);
    setDebitAcctPage(1);
    setCreditAcctPage(1);
  }, [searchQuery, filterType, filterPeriod, filterFixedAssetType, filterBranch, filterLeaseClassification, customPeriodStart, customPeriodEnd]);

  const handleDownloadExcel = useCallback(() => {
    downloadExcel(filteredTransactions);
  }, [filteredTransactions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <LoadError message={loadError} onRetry={refreshData} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-green-700 font-medium">{successMessage}</p>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-700 font-medium">{errorMessage}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-8">
          <TransactionsHeader
            permissions={permissions}
            onOpenMonthEndModal={monthEnd.handleOpenMonthEndModal}
            onAddTransaction={() => setShowAddModal(true)}
          />

          <div className="mb-8">
            <TransactionFiltersPanel
              filterPeriod={filterPeriod}
              setFilterPeriod={setFilterPeriod}
              filterFixedAssetType={filterFixedAssetType}
              setFilterFixedAssetType={setFilterFixedAssetType}
              filterBranch={filterBranch}
              setFilterBranch={setFilterBranch}
              filterLeaseClassification={filterLeaseClassification}
              setFilterLeaseClassification={setFilterLeaseClassification}
              customPeriodStart={customPeriodStart}
              setCustomPeriodStart={setCustomPeriodStart}
              customPeriodEnd={customPeriodEnd}
              setCustomPeriodEnd={setCustomPeriodEnd}
              uniquePeriods={uniquePeriods}
              uniqueFixedAssetTypes={uniqueFixedAssetTypes}
              branches={branches}
              filteredCount={filteredTransactions.length}
              onDownloadExcel={handleDownloadExcel}
            />

            <TransactionSummaryCards
              effectiveCount={effectiveCount}
              totalDebits={totalDebits}
              totalCredits={totalCredits}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <DebitsByAccountTable
                debitAccountSummary={debitAccountSummary}
                activeBranches={activeBranches}
                debitByAccountAndBranch={debitByAccountAndBranch}
                totalDebits={totalDebits}
                debitAcctPage={debitAcctPage}
                setDebitAcctPage={setDebitAcctPage}
                acctPageSize={acctPageSize}
                onOpenBreakdown={(account) => setBreakdownModal({ side: 'debit', account })}
              />

              <CreditsByAccountTable
                creditAccountSummary={creditAccountSummary}
                activeBranches={activeBranches}
                creditByAccountAndBranch={creditByAccountAndBranch}
                totalCredits={totalCredits}
                creditAcctPage={creditAcctPage}
                setCreditAcctPage={setCreditAcctPage}
                acctPageSize={acctPageSize}
                onOpenBreakdown={(account) => setBreakdownModal({ side: 'credit', account })}
              />
            </div>
          </div>

          <TransactionListControls
            viewMode={viewMode}
            setViewMode={setViewMode}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filterType={filterType}
            setFilterType={setFilterType}
            filterPeriod={filterPeriod}
            setFilterPeriod={setFilterPeriod}
            uniquePeriods={uniquePeriods}
          />

          {(serverMode ? serverRows.length === 0 && serverTotalCount === 0 : filteredTransactions.length === 0) ? (
            <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
              <Receipt className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium mb-2">No transactions found</p>
              <p className="text-sm text-slate-500">Record your first transaction to get started</p>
            </div>
          ) : viewMode === 'week' ? (
            <WeeklyTransactionsView
              weeklyGroups={weeklyGroups}
              expandedWeeks={expandedWeeks}
              expandedSections={expandedSections}
              toggleWeek={toggleWeek}
              toggleSection={toggleSection}
              leases={leases}
              permissions={permissions}
              onSelectTransaction={setSelectedTransaction}
              onDeleteTransaction={handleDeleteTransaction}
            />
          ) : viewMode === 'grid' ? (
            <TransactionGridView
              transactions={serverRows}
              leases={leases}
              permissions={permissions}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              isServerMode={true}
              serverTotalCount={serverTotalCount}
              onSelectTransaction={setSelectedTransaction}
              onDeleteTransaction={handleDeleteTransaction}
            />
          ) : viewMode === 'table' ? (
            <TransactionTableView
              transactions={serverRows}
              leases={leases}
              permissions={permissions}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              totalCount={serverTotalCount}
              onSelectTransaction={setSelectedTransaction}
              onDeleteTransaction={handleDeleteTransaction}
            />
          ) : (
            <TransactionKanbanView
              filteredTransactions={filteredTransactions}
              leases={leases}
              permissions={permissions}
              onSelectTransaction={setSelectedTransaction}
              onDeleteTransaction={handleDeleteTransaction}
            />
          )}
        </div>

        {showAddModal && (
          <AddTransactionModal
            leases={leases}
            formData={formData}
            setFormData={setFormData}
            submitting={submitting}
            onClose={() => setShowAddModal(false)}
            onSubmit={(e) => handleSubmit(e, formData)}
          />
        )}

        {selectedTransaction && (
          <TransactionDetailsModal
            transaction={selectedTransaction}
            leases={leases}
            permissions={permissions}
            onClose={() => setSelectedTransaction(null)}
            onReverse={(t) => {
              handleReverseTransaction(t);
              setSelectedTransaction(null);
            }}
            onDelete={handleDeleteTransaction}
          />
        )}

        {monthEnd.showMonthEndModal && (
          <MonthEndModal
            monthEndPeriod={monthEnd.monthEndPeriod}
            setMonthEndPeriod={monthEnd.setMonthEndPeriod}
            monthEndPreview={monthEnd.monthEndPreview}
            submitting={monthEnd.submitting}
            errorMessage={errorMessage}
            successMessage={successMessage}
            onClose={() => {
              monthEnd.setShowMonthEndModal(false);
              monthEnd.setMonthEndPreview([]);
            }}
            onGeneratePreview={monthEnd.handleGenerateMonthEndPreview}
            onProcess={monthEnd.handleProcessMonthEnd}
          />
        )}

        {breakdownModal && (
          <AccountBreakdownModal
            side={breakdownModal.side}
            account={breakdownModal.account}
            filteredTransactions={filteredTransactions}
            onClose={() => setBreakdownModal(null)}
          />
        )}
      </div>
    </div>
  );
}

export type { UserRole, UserPermissions };

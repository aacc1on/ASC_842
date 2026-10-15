import { useEffect, useState } from 'react';
import { type AssetTypeOption, type BranchOption } from '../../components/reports/types';
import { type Lease } from '../../types/lease';
import { type BalanceSheetData, type CashFlowData, type LeaseBalancesByType, type ProfitLossData } from '../../utils/financialReports';
import { loadFinancialSnapshot, loadMonthReports, loadWeekReports } from '../../utils/reports/financialSnapshot';
import { type DetailedLedgerEntry } from '../../utils/reports/ledger';
import { breakdownGranularity, type MonthReport, type PeriodMode, type WeekReport } from '../../utils/reports/period';

interface FinancialReportsParams {
  active: boolean;
  leases: Lease[];
  filteredLeases: Lease[];
  periodMode: PeriodMode;
  periodStart: string;
  periodEnd: string;
  branchOptions: BranchOption[];
  assetTypeOptions: AssetTypeOption[];
}

export function useFinancialReportsData({ active, leases, filteredLeases, periodMode, periodStart, periodEnd, branchOptions, assetTypeOptions }: FinancialReportsParams) {
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [balancesByType, setBalancesByType] = useState<LeaseBalancesByType | null>(null);
  const [profitLoss, setProfitLoss] = useState<ProfitLossData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [detailedLedger, setDetailedLedger] = useState<DetailedLedgerEntry[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(50);
  const [weekReports, setWeekReports] = useState<WeekReport[]>([]);
  const [weekReportsLoading, setWeekReportsLoading] = useState(false);
  const [monthReports, setMonthReports] = useState<MonthReport[]>([]);
  const [monthReportsLoading, setMonthReportsLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (filteredLeases.length === 0) {
      setBalanceSheet(null);
      setBalancesByType(null);
      setProfitLoss(null);
      setCashFlow(null);
      setDetailedLedger([]);
      setLedgerPage(1);
      setWeekReports([]);
      setMonthReports([]);
      return;
    }

    let ignore = false;
    const run = async () => {
      const snapshot = await loadFinancialSnapshot(filteredLeases, leases, periodStart, periodEnd, { branches: branchOptions, assetTypes: assetTypeOptions });
      if (ignore) return;
      setBalanceSheet(snapshot.balanceSheet);
      setBalancesByType(snapshot.balancesByType);
      setProfitLoss(snapshot.profitLoss);
      setCashFlow(snapshot.cashFlow);
      setDetailedLedger(snapshot.detailedLedger);
      if (!snapshot.profitLoss) return;

      const granularity = breakdownGranularity(periodMode, periodStart, periodEnd);
      if (granularity === 'month') {
        setMonthReportsLoading(true);
        loadMonthReports(filteredLeases, periodStart, periodEnd).then((r) => {
          if (ignore) return;
          setMonthReports(r);
          setMonthReportsLoading(false);
        });
      } else {
        setMonthReports([]);
      }
      if (granularity === 'week') {
        setWeekReportsLoading(true);
        loadWeekReports(filteredLeases, periodStart, periodEnd).then((r) => {
          if (ignore) return;
          setWeekReports(r);
          setWeekReportsLoading(false);
        });
      } else {
        setWeekReports([]);
      }
    };
    run();
    return () => { ignore = true; };
  }, [active, leases, filteredLeases, periodMode, periodStart, periodEnd, branchOptions, assetTypeOptions]);

  return {
    balanceSheet,
    balancesByType,
    profitLoss,
    cashFlow,
    detailedLedger,
    ledgerPage,
    ledgerPageSize,
    setLedgerPage,
    setLedgerPageSize,
    weekReports,
    weekReportsLoading,
    monthReports,
    monthReportsLoading,
  };
}

export type FinancialReportsData = ReturnType<typeof useFinancialReportsData>;

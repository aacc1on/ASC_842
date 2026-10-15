import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { type Lease } from '../../types/lease';
import { fetchAll, fetchAllIn } from '../../utils/fetchAll';
import {
  buildAssetBreakdownTransactions,
  buildAssetTransactionRows,
  defaultAssetSortDir,
  sortAssetRows,
  type AssetBreakdownDetail,
  type AssetSortKey,
  type AssetTransactionRow,
  type ScheduleRow,
} from '../../utils/reports/transactionsByAsset';
import { currentOrgId } from '../../utils/currentOrg';
import { toUserMessage } from '../../utils/errors';

const LOAD_FAILED = 'Failed to load asset transactions.';
const BREAKDOWN_FAILED = 'Failed to load the transaction breakdown.';

interface TransactionsByAssetParams {
  active: boolean;
  filteredLeases: Lease[];
  periodStart: string;
  periodEnd: string;
}

export function useTransactionsByAssetData({ active, filteredLeases, periodStart, periodEnd }: TransactionsByAssetParams) {
  const [assetTransactions, setAssetTransactions] = useState<AssetTransactionRow[]>([]);
  const [assetTxnLoading, setAssetTxnLoading] = useState(false);
  const [assetTxnFullscreen, setAssetTxnFullscreen] = useState(false);
  const [assetSortKey, setAssetSortKey] = useState<AssetSortKey>('leaseName');
  const [assetSortDir, setAssetSortDir] = useState<'asc' | 'desc'>('asc');
  const [assetBreakdown, setAssetBreakdown] = useState<AssetBreakdownDetail | null>(null);
  const [assetTxnError, setAssetTxnError] = useState<string | null>(null);
  const [breakdownError, setBreakdownError] = useState<{ message: string; retry: () => void } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retryAssetTransactions = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    setAssetTxnError(null);
    if (!active || filteredLeases.length === 0) {
      setAssetTxnLoading(false);
      return;
    }
    let ignore = false;
    const run = async () => {
      setAssetTxnLoading(true);
      const leaseIds = filteredLeases.map((l) => l.id);
      const orgId = await currentOrgId();
      const schedData = await fetchAllIn<ScheduleRow>('amortization schedules', leaseIds, (batch, from, to) => supabase
        .from('amortization_schedules')
        .select('lease_id, period_date, period_number, beginning_liability, payment_amount, interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense')
        .eq('organization_id', orgId)
        .in('lease_id', batch)
        .lte('period_date', periodEnd)
        .order('period_number', { ascending: true })
        .order('id')
        .range(from, to));
      if (ignore) return;
      setAssetTransactions(buildAssetTransactionRows(schedData, filteredLeases, periodStart));
    };
    run()
      .catch((err) => {
        if (ignore) return;
        setAssetTransactions([]);
        setAssetTxnError(toUserMessage(err, LOAD_FAILED));
      })
      .finally(() => { if (!ignore) setAssetTxnLoading(false); });
    return () => { ignore = true; };
  }, [active, filteredLeases, periodStart, periodEnd, attempt]);

  const handleAssetSort = (key: AssetSortKey) => {
    if (assetSortKey === key) {
      setAssetSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setAssetSortKey(key);
      setAssetSortDir(defaultAssetSortDir(key));
    }
  };

  const loadAssetBreakdown = async (leaseId: string, leaseName: string, column: string) => {
    setBreakdownError(null);
    try {
      await fetchBreakdown(leaseId, leaseName, column);
    } catch (err) {
      setBreakdownError({
        message: toUserMessage(err, BREAKDOWN_FAILED),
        retry: () => { void loadAssetBreakdown(leaseId, leaseName, column); },
      });
    }
  };

  const fetchBreakdown = async (leaseId: string, leaseName: string, column: string) => {
    const orgId = await currentOrgId();
    const schedData = await fetchAll<ScheduleRow>('amortization schedule', (from, to) => supabase
      .from('amortization_schedules')
      .select('period_number, period_date, beginning_liability, payment_amount, interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense')
      .eq('organization_id', orgId)
      .eq('lease_id', leaseId)
      .gte('period_date', periodStart)
      .lte('period_date', periodEnd)
      .order('period_number', { ascending: true })
      .order('id')
      .range(from, to));
    setAssetBreakdown({ leaseId, leaseName, column, transactions: buildAssetBreakdownTransactions(schedData, column) });
  };

  return {
    assetTransactions,
    sortedAssetTransactions: sortAssetRows(assetTransactions, assetSortKey, assetSortDir),
    assetTxnLoading,
    assetTxnError,
    retryAssetTransactions,
    breakdownError,
    assetTxnFullscreen,
    setAssetTxnFullscreen,
    assetSortKey,
    assetSortDir,
    handleAssetSort,
    loadAssetBreakdown,
    assetBreakdown,
    setAssetBreakdown,
  };
}

export type TransactionsByAssetData = ReturnType<typeof useTransactionsByAssetData>;

import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type { Transaction } from '../components/transactions/types';
import {
  generateMonthEndTransactionsWithSkips,
  validateMonthEndPeriod,
  periodHasEnded,
  formatPeriodDisplay,
  type StoredScheduleMap,
  type StoredScheduleRow,
  type SkippedLease,
} from '../utils/monthEndTransactions';
import { toUserMessage } from '../utils/errors';
import { reportCriticalError } from '../utils/errorReporter';
import { fetchAllIn } from '../utils/fetchAll';
import { currentOrgId } from '../utils/currentOrg';

interface ConfirmFn {
  (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean>;
}

interface UseMonthEndArgs {
  leases: Lease[];
  transactions: Transaction[];
  refreshData: () => void;
  setSuccessMessage: (v: string) => void;
  setErrorMessage: (v: string) => void;
  confirmDialog: { confirm: ConfirmFn };
}

interface MonthEndPreviewRow {
  lease_id: string;
  lease_name: string;
  transaction_date: string;
  transaction_type: string;
  account_debited: string;
  account_credited: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  reference_number: string;
  period: string;
}

interface UseMonthEndResult {
  showMonthEndModal: boolean;
  setShowMonthEndModal: (v: boolean) => void;
  monthEndPeriod: string;
  setMonthEndPeriod: (v: string) => void;
  monthEndPreview: MonthEndPreviewRow[];
  setMonthEndPreview: React.Dispatch<React.SetStateAction<MonthEndPreviewRow[]>>;
  submitting: boolean;
  handleOpenMonthEndModal: () => void;
  handleGenerateMonthEndPreview: () => Promise<void>;
  handleProcessMonthEnd: () => Promise<void>;
  skippedLeases: SkippedLease[];
}

function currentMonthPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Month-end processing: open the modal, generate a preview of the
 * depreciation/interest/payment entries for a chosen period, and on confirm
 * persist them as a `month_end_documents` row + linked `transactions` rows.
 */
export function useMonthEnd({
  leases,
  transactions,
  refreshData,
  setSuccessMessage,
  setErrorMessage,
  confirmDialog,
}: UseMonthEndArgs): UseMonthEndResult {
  const [showMonthEndModal, setShowMonthEndModal] = useState(false);
  const [monthEndPeriod, setMonthEndPeriod] = useState<string>(currentMonthPeriod());
  const [monthEndPreview, setMonthEndPreview] = useState<MonthEndPreviewRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [skippedLeases, setSkippedLeases] = useState<SkippedLease[]>([]);

  const handleOpenMonthEndModal = useCallback(() => {
    setMonthEndPeriod(currentMonthPeriod());
    setMonthEndPreview([]);
    setSkippedLeases([]);
    setErrorMessage('');
    setShowMonthEndModal(true);
  }, [setErrorMessage]);

  const handleGenerateMonthEndPreview = useCallback(async () => {
    setSubmitting(true);
    setErrorMessage('');
    setMonthEndPreview([]);
    setSkippedLeases([]);

    try {
      const validation = validateMonthEndPeriod(monthEndPeriod);
      if (!validation.valid) {
        setErrorMessage(validation.error ?? 'Invalid period.');
        return;
      }
      if (!periodHasEnded(monthEndPeriod)) {
        setErrorMessage(`${formatPeriodDisplay(monthEndPeriod)} has not ended yet. Month-end can be processed only after the last day of the month.`);
        return;
      }

      const alreadyHas = transactions.some(
        (t) => t.period === monthEndPeriod && t.month_end_document_id,
      );
      if (alreadyHas) {
        setErrorMessage(`Month-end has already been processed for ${monthEndPeriod}.`);
        return;
      }

      const orgId = await currentOrgId();
      const { data: pendingDoc, error: pendingError } = await supabase
        .from('month_end_documents')
        .select('id')
        .eq('organization_id', orgId)
        .eq('period', monthEndPeriod)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (pendingError) {
        setErrorMessage(toUserMessage(pendingError, 'Could not check existing month-end documents.'));
        return;
      }
      if (pendingDoc) {
        setErrorMessage(`Month-end for ${monthEndPeriod} is already awaiting approval in Settings > Approval.`);
        return;
      }

      const exemptLeaseIds = leases
        .filter((l) => l.accounting_treatment === 'short_term_exemption' && l.id)
        .map((l) => l.id);
      let leasesWithTranches = leases;
      if (exemptLeaseIds.length > 0) {
        const trancheMap = new Map<string, { fromMonth: number; toMonth: number; paymentAmount: number }[]>();
        const tranches = await fetchAllIn<{ lease_id: string; from_month: number; to_month: number; payment_amount: number }>(
          'payment schedules',
          exemptLeaseIds,
          (batch, from, to) => supabase
            .from('lease_payment_schedules')
            .select('lease_id, from_month, to_month, payment_amount')
            .eq('organization_id', orgId)
            .in('lease_id', batch)
            .order('from_month', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        );
        for (const r of tranches) {
          const arr = trancheMap.get(r.lease_id) ?? [];
          arr.push({ fromMonth: Number(r.from_month), toMonth: Number(r.to_month), paymentAmount: Number(r.payment_amount) || 0 });
          trancheMap.set(r.lease_id, arr);
        }
        leasesWithTranches = leases.map((l) => {
          const tranches = trancheMap.get(l.id);
          return tranches ? { ...l, paymentTranches: tranches } : l;
        });
      }

      const recognizedLeaseIds = leasesWithTranches
        .filter((l) => l.accounting_treatment !== 'short_term_exemption' && l.id)
        .map((l) => l.id);
      const storedSchedules: StoredScheduleMap = new Map();
      if (recognizedLeaseIds.length > 0) {
        const rows = await fetchAllIn<StoredScheduleRow & { lease_id: string }>('amortization schedules', recognizedLeaseIds, (batch, from, to) => supabase
          .from('amortization_schedules')
          .select('lease_id, period_number, period_date, beginning_liability, payment_amount, interest_expense, principal_reduction, ending_liability, rou_asset_balance, depreciation_expense')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .order('lease_id', { ascending: true })
          .order('period_number', { ascending: true })
          .range(from, to));
        for (const r of rows) {
          const arr = storedSchedules.get(r.lease_id) ?? [];
          arr.push(r);
          storedSchedules.set(r.lease_id, arr);
        }
      }

      const unprocessed = await findEarliestUnprocessedPeriod(orgId, storedSchedules, leasesWithTranches, monthEndPeriod);
      if (unprocessed) {
        setErrorMessage(
          `${formatPeriodDisplay(unprocessed.period)} has not been processed yet (${unprocessed.leaseNames.join(', ')}). Process month-end for earlier months in order before ${formatPeriodDisplay(monthEndPeriod)}.`,
        );
        return;
      }

      const { transactions: generated, skippedLeases: skipped } = generateMonthEndTransactionsWithSkips(leasesWithTranches, monthEndPeriod, storedSchedules);
      setMonthEndPreview(generated);
      setSkippedLeases(skipped);
      if (skipped.length > 0) {
        setErrorMessage(`${skipped.length} lease(s) have no schedule row for ${formatPeriodDisplay(monthEndPeriod)}: ${skipped.map(s => s.lease_name).join(', ')}. Regenerate their schedules before posting; month-end cannot be processed while a lease would be left out.`);
      } else if (generated.length === 0) {
        setErrorMessage(`No month-end entries were found for ${formatPeriodDisplay(monthEndPeriod)}.`);
      }
    } catch (err) {
      setErrorMessage(toUserMessage(err, 'Failed to generate the month-end preview.'));
    } finally {
      setSubmitting(false);
    }
  }, [monthEndPeriod, leases, transactions, setErrorMessage]);

  const handleProcessMonthEnd = useCallback(async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (monthEndPreview.length === 0) {
      setErrorMessage('Generate a preview first.');
      return;
    }
    if (skippedLeases.length > 0) {
      setErrorMessage(`Month-end cannot be processed while ${skippedLeases.length} lease(s) would be left out: ${skippedLeases.map((s) => s.lease_name).join(', ')}.`);
      return;
    }

    const ok = await confirmDialog.confirm({
      title: 'Process month-end?',
      message: `This will post ${monthEndPreview.length} journal entries for ${formatPeriodDisplay(monthEndPeriod)}.`,
      confirmLabel: 'Process',
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        setErrorMessage('You must be signed in.');
        return;
      }

      const organizationId = await currentOrgId();

      const summary = {
        total_interest: sumByType(monthEndPreview, 'interest'),
        total_depreciation: sumByType(monthEndPreview, 'amortization'),
        total_principal: sumByType(monthEndPreview, 'payment'),
      };
      const uniqueLeases = new Set(monthEndPreview.map((t) => t.lease_id));

      const entries = monthEndPreview.map((t) => ({
        lease_id: t.lease_id,
        transaction_date: t.transaction_date,
        transaction_type: t.transaction_type,
        account_debited: t.account_debited,
        account_credited: t.account_credited,
        debit_amount: t.debit_amount,
        credit_amount: t.credit_amount,
        description: t.description,
        reference_number: t.reference_number,
        period: t.period,
      }));

      const { data: doc, error: docError } = await supabase
        .from('month_end_documents')
        .insert({
          user_id: userId,
          organization_id: organizationId,
          period: monthEndPeriod,
          period_label: formatPeriodDisplay(monthEndPeriod),
          lease_count: uniqueLeases.size,
          transaction_count: monthEndPreview.length,
          total_interest: summary.total_interest,
          total_depreciation: summary.total_depreciation,
          total_principal: summary.total_principal,
          status: 'posted',
          entries,
        })
        .select('id, status')
        .single();

      if (docError || !doc) {
        if (docError) reportCriticalError(supabase, 'month_end', docError);
        setErrorMessage(toUserMessage(docError, 'Failed to create month-end document.'));
        return;
      }

      if (doc.status === 'pending') {
        setSuccessMessage(`Month-end for ${formatPeriodDisplay(monthEndPeriod)} sent for approval. Entries will post once approved in Settings > Approval.`);
        setMonthEndPreview([]);
        setShowMonthEndModal(false);
        refreshData();
        return;
      }

      setSuccessMessage(`Month-end for ${formatPeriodDisplay(monthEndPeriod)} posted successfully.`);
      setMonthEndPreview([]);
      setShowMonthEndModal(false);
      refreshData();
    } catch (err) {
      reportCriticalError(supabase, 'month_end', err);
      setErrorMessage(toUserMessage(err, 'Failed to process month-end.'));
    } finally {
      setSubmitting(false);
    }
  }, [monthEndPreview, skippedLeases, monthEndPeriod, confirmDialog, refreshData, setSuccessMessage, setErrorMessage]);

  return {
    showMonthEndModal,
    setShowMonthEndModal,
    monthEndPeriod,
    setMonthEndPeriod,
    monthEndPreview,
    setMonthEndPreview,
    submitting,
    handleOpenMonthEndModal,
    handleGenerateMonthEndPreview,
    handleProcessMonthEnd,
    skippedLeases,
  };
}

async function findEarliestUnprocessedPeriod(
  orgId: string,
  schedules: StoredScheduleMap,
  leases: Lease[],
  period: string,
): Promise<{ period: string; leaseNames: string[] } | null> {
  const leaseIds = Array.from(schedules.keys());
  if (leaseIds.length === 0) return null;

  const processed = new Set<string>();
  const [posted, caughtUp] = await Promise.all([
    fetchAllIn<{ lease_id: string; period: string }>('posted month-end transactions', leaseIds, (batch, from, to) => supabase
      .from('transactions')
      .select('lease_id, period')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .not('month_end_document_id', 'is', null)
      .lt('period', period)
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAllIn<{ lease_id: string; missed_period: string }>('catch-up corrections', leaseIds, (batch, from, to) => supabase
      .from('month_end_catch_up_lines')
      .select('lease_id, missed_period')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .lt('missed_period', period)
      .order('id', { ascending: true })
      .range(from, to)),
  ]);
  for (const r of posted) processed.add(`${r.lease_id}|${r.period}`);
  for (const r of caughtUp) processed.add(`${r.lease_id}|${r.missed_period}`);

  const missingByPeriod = new Map<string, string[]>();
  const nameById = new Map(leases.map((l) => [l.id, l.lease_name]));
  for (const [leaseId, rows] of schedules) {
    for (const r of rows) {
      const rowPeriod = String(r.period_date).slice(0, 7);
      if (rowPeriod >= period || processed.has(`${leaseId}|${rowPeriod}`)) continue;
      const names = missingByPeriod.get(rowPeriod) ?? [];
      names.push(nameById.get(leaseId) ?? 'Unnamed lease');
      missingByPeriod.set(rowPeriod, names);
      break;
    }
  }
  if (missingByPeriod.size === 0) return null;

  const earliest = Array.from(missingByPeriod.keys()).sort()[0];
  const names = missingByPeriod.get(earliest) ?? [];
  const shown = names.slice(0, 3);
  if (names.length > 3) shown.push(`+${names.length - 3} more`);
  return { period: earliest, leaseNames: shown };
}

function sumByType(rows: MonthEndPreviewRow[], type: string): number {
  return rows
    .filter((r) => r.transaction_type === type)
    .reduce((s, r) => s + Number(r.debit_amount ?? 0), 0);
}

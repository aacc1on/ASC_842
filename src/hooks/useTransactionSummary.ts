import { useMemo } from 'react';
import type { AccountSummaryItem, Transaction } from '../components/transactions/types';

export interface BranchColumn {
  id: string;
  branch_name: string;
  branch_code?: string | null;
  label: string;
}

interface UseTransactionSummaryResult {
  totalDebits: number;
  totalCredits: number;
  debitAccountSummary: AccountSummaryItem[];
  creditAccountSummary: AccountSummaryItem[];
  activeBranches: BranchColumn[];
  debitByAccountAndBranch: Record<string, Record<string, number>>;
  creditByAccountAndBranch: Record<string, Record<string, number>>;
}

function branchDisplayName(name: string | null | undefined, code: string | null | undefined): string {
  if (!name) return 'No branch';
  return code ? `${name} (${code})` : name;
}

/**
 * Computes totals, per-account summaries, the list of branches that appear in
 * the filtered set, and a per-account × per-branch debit/credit matrix used by
 * the branch-column tables.
 */
export function useTransactionSummary(
  filteredTransactions: Transaction[],
): UseTransactionSummaryResult {
  return useMemo(() => {
    let totalDebits = 0;
    let totalCredits = 0;
    const debitMap = new Map<string, { total: number; count: number }>();
    const creditMap = new Map<string, { total: number; count: number }>();
    const branchSet = new Map<string, BranchColumn>();
    const debitByAccountAndBranch: Record<string, Record<string, number>> = {};
    const creditByAccountAndBranch: Record<string, Record<string, number>> = {};

    for (const t of filteredTransactions) {
      totalDebits += Number(t.debit_amount ?? 0);
      totalCredits += Number(t.credit_amount ?? 0);

      if (Number(t.debit_amount ?? 0) > 0 && t.account_debited) {
        const cur = debitMap.get(t.account_debited) ?? { total: 0, count: 0 };
        cur.total += Number(t.debit_amount);
        cur.count += 1;
        debitMap.set(t.account_debited, cur);

        const branchKey = t.branch_id ?? 'unassigned';
        if (!branchSet.has(branchKey)) {
          branchSet.set(branchKey, {
            id: branchKey,
            branch_name: t.branch_name ?? '',
            branch_code: t.branch_code ?? null,
            label: branchDisplayName(t.branch_name, t.branch_code),
          });
        }
        debitByAccountAndBranch[t.account_debited] ??= {};
        debitByAccountAndBranch[t.account_debited][branchKey] =
          (debitByAccountAndBranch[t.account_debited][branchKey] ?? 0) + Number(t.debit_amount);
      }

      if (Number(t.credit_amount ?? 0) > 0 && t.account_credited) {
        const cur = creditMap.get(t.account_credited) ?? { total: 0, count: 0 };
        cur.total += Number(t.credit_amount);
        cur.count += 1;
        creditMap.set(t.account_credited, cur);

        const branchKey = t.branch_id ?? 'unassigned';
        if (!branchSet.has(branchKey)) {
          branchSet.set(branchKey, {
            id: branchKey,
            branch_name: t.branch_name ?? '',
            branch_code: t.branch_code ?? null,
            label: branchDisplayName(t.branch_name, t.branch_code),
          });
        }
        creditByAccountAndBranch[t.account_credited] ??= {};
        creditByAccountAndBranch[t.account_credited][branchKey] =
          (creditByAccountAndBranch[t.account_credited][branchKey] ?? 0) + Number(t.credit_amount);
      }
    }

    const debitAccountSummary: AccountSummaryItem[] = Array.from(debitMap.entries())
      .map(([account, v]) => ({ account, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total);
    const creditAccountSummary: AccountSummaryItem[] = Array.from(creditMap.entries())
      .map(([account, v]) => ({ account, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total);

    const activeBranches = Array.from(branchSet.values()).sort((a, b) => {
      const aCode = a.branch_code ?? 'zzz';
      const bCode = b.branch_code ?? 'zzz';
      if (aCode !== bCode) return aCode.localeCompare(bCode);
      return a.label.localeCompare(b.label);
    });

    return {
      totalDebits,
      totalCredits,
      debitAccountSummary,
      creditAccountSummary,
      activeBranches,
      debitByAccountAndBranch,
      creditByAccountAndBranch,
    };
  }, [filteredTransactions]);
}

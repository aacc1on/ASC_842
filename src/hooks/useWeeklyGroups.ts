import { useCallback, useMemo, useState } from 'react';
import type { Transaction, TransactionSection, WeeklyGroup } from '../components/transactions/types';
import { parseLocalYMD, startOfIsoWeek } from '../utils/isoWeek';
import { toYMD } from '../utils/formatting';

interface UseWeeklyGroupsResult {
  weeklyGroups: WeeklyGroup[];
  expandedWeeks: Record<string, boolean>;
  expandedSections: Record<string, boolean>;
  toggleWeek: (key: string) => void;
  toggleSection: (key: string) => void;
}

function formatWeekLabel(start: Date, end: Date): string {
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}

/**
 * Groups filtered transactions into ISO weeks (Mon–Sun) sorted descending,
 * and tracks which weeks and which debit/credit sections are expanded.
 */
export function useWeeklyGroups(filteredTransactions: Transaction[]): UseWeeklyGroupsResult {
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const weeklyGroups = useMemo(() => {
    const byKey = new Map<string, WeeklyGroup>();

    for (const t of filteredTransactions) {
      if (!t.transaction_date) continue;
      const date = parseLocalYMD(t.transaction_date);
      if (Number.isNaN(date.getTime())) continue;
      const start = startOfIsoWeek(date);
      const key = toYMD(start);
      let group = byKey.get(key);
      if (!group) {
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        group = {
          weekKey: key,
          weekLabel: formatWeekLabel(start, end),
          startDate: start,
          endDate: end,
          transactions: [],
          totalDebits: 0,
          totalCredits: 0,
        };
        byKey.set(key, group);
      }
      group.transactions.push(t);
      group.totalDebits += Number(t.debit_amount ?? 0);
      group.totalCredits += Number(t.credit_amount ?? 0);
    }

    return Array.from(byKey.values()).sort(
      (a, b) => b.startDate.getTime() - a.startDate.getTime(),
    );
  }, [filteredTransactions]);

  const toggleWeek = useCallback((key: string) => {
    setExpandedWeeks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return {
    weeklyGroups,
    expandedWeeks,
    expandedSections,
    toggleWeek,
    toggleSection,
  };
}

export type { TransactionSection };

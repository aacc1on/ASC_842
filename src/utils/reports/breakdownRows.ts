import type { CashFlowData, ProfitLossData } from '../financialReports';
import { roundWhole, toCents } from './footing';
import type { MonthReport, WeekReport } from './period';

export interface BreakdownRow<R> {
  label: string;
  indent?: boolean;
  bold?: boolean;
  color?: string;
  /** Detail rows read a value from the slice; subtotal rows are the sum of the listed rows' displayed values. */
  get?: (r: R) => number;
  sumOf?: string[];
}

type WithPl = { pl: ProfitLossData | null };
type WithCf = { cf: CashFlowData | null };

export const PL_BREAKDOWN_ROWS: BreakdownRow<WithPl>[] = [
  { label: 'Depreciation Expense', indent: true, get: (r) => r.pl?.operatingExpenses.depreciationExpense ?? 0 },
  { label: 'Lease Expense (Operating)', indent: true, get: (r) => r.pl?.operatingExpenses.leaseExpense ?? 0 },
  { label: 'Short-term Lease Cost', indent: true, get: (r) => r.pl?.operatingExpenses.shortTermLeaseCost ?? 0 },
  { label: 'Initial Direct Costs', indent: true, get: (r) => r.pl?.operatingExpenses.initialDirectCostsAmortized ?? 0 },
  { label: 'Total Operating Expenses', bold: true, sumOf: ['Depreciation Expense', 'Lease Expense (Operating)', 'Short-term Lease Cost', 'Initial Direct Costs'] },
  { label: 'Interest Expense', indent: true, get: (r) => r.pl?.financingCosts.interestExpense ?? 0 },
  { label: 'Total Lease Expenses', bold: true, sumOf: ['Total Operating Expenses', 'Interest Expense'] },
  { label: 'Gain on Lease Termination', indent: true, get: (r) => r.pl?.gainLossOnTermination.gain ?? 0 },
  { label: 'Loss on Lease Termination', indent: true, get: (r) => r.pl?.gainLossOnTermination.loss ?? 0 },
];

export const CF_BREAKDOWN_ROWS: BreakdownRow<WithCf>[] = [
  { label: 'Interest Paid (Finance)', indent: true, color: 'text-red-600', get: (r) => r.cf?.operatingActivities.interestPaid ?? 0 },
  { label: 'Lease Payments (Operating)', indent: true, color: 'text-red-600', get: (r) => r.cf?.operatingActivities.leasePayments ?? 0 },
  { label: 'Short-term Lease Payments', indent: true, color: 'text-red-600', get: (r) => r.cf?.operatingActivities.shortTermLeasePayments ?? 0 },
  { label: 'Lease Termination Payments', indent: true, color: 'text-red-600', get: (r) => r.cf?.operatingActivities.terminationCashPaid ?? 0 },
  { label: 'Net Operating Cash Flow', bold: true, sumOf: ['Interest Paid (Finance)', 'Lease Payments (Operating)', 'Short-term Lease Payments', 'Lease Termination Payments'] },
  { label: 'Principal Payments (Finance)', indent: true, color: 'text-red-600', get: (r) => r.cf?.financingActivities.principalPayments ?? 0 },
  { label: 'Initial Direct Costs Paid', indent: true, color: 'text-red-600', get: (r) => r.cf?.financingActivities.initialDirectCostsPaid ?? 0 },
  { label: 'Residual Value Guarantee Paid', indent: true, color: 'text-red-600', get: (r) => r.cf?.financingActivities.residualValueGuaranteePaid ?? 0 },
  { label: 'Net Financing Cash Flow', bold: true, sumOf: ['Principal Payments (Finance)', 'Initial Direct Costs Paid', 'Residual Value Guarantee Paid'] },
  { label: 'Net Change in Cash', bold: true, color: 'text-red-600', sumOf: ['Net Operating Cash Flow', 'Net Financing Cash Flow'] },
];

/** One column of a week/month breakdown table. Week columns are keyed by label, month columns by start date. */
export interface ReportSlice {
  key: string;
  header: string;
  start: string;
  end: string;
  pl: ProfitLossData | null;
  cf: CashFlowData | null;
}

export function weekSlices(reports: WeekReport[]): ReportSlice[] {
  return reports.map((r) => ({ key: r.week.label, header: r.week.label, start: r.week.start, end: r.week.end, pl: r.pl, cf: r.cf }));
}

export function monthSlices(reports: MonthReport[]): ReportSlice[] {
  return reports.map((r) => ({ key: r.month.start, header: r.month.shortLabel, start: r.month.start, end: r.month.end, pl: r.pl, cf: r.cf }));
}

export interface BreakdownTableRow {
  label: string;
  values: number[];
  total: number;
}

/**
 * Cells per row and slice, footed both ways: detail cells are rounded to the unit (cents or whole dollars),
 * subtotal cells are sums of the displayed cells they cover, and the Total column is the sum across slices.
 */
export function breakdownTable<R>(rows: BreakdownRow<R>[], slices: R[], unit: 'cents' | 'whole' = 'cents'): BreakdownTableRow[] {
  const toUnit = unit === 'cents' ? toCents : roundWhole;
  const scale = unit === 'cents' ? 100 : 1;
  const columns = slices.map((slice) => {
    const cells = new Map<string, number>();
    for (const row of rows) {
      const v = row.sumOf
        ? row.sumOf.reduce((sum, label) => sum + (cells.get(label) ?? 0), 0)
        : toUnit(row.get?.(slice) ?? 0);
      cells.set(row.label, v);
    }
    return cells;
  });
  return rows.map((row) => {
    const units = columns.map((c) => c.get(row.label) ?? 0);
    return { label: row.label, values: units.map((u) => u / scale), total: units.reduce((s, u) => s + u, 0) / scale };
  });
}

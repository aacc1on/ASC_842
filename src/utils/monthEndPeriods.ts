import type { MonthEndTransaction } from './monthEndTypes';

export function validateMonthEndPeriod(period: string): { valid: boolean; error?: string } {
  const periodRegex = /^\d{4}-\d{2}$/;

  if (!periodRegex.test(period)) {
    return { valid: false, error: 'Period must be in YYYY-MM format' };
  }

  const [year, month] = period.split('-').map(Number);

  if (month < 1 || month > 12) {
    return { valid: false, error: 'Month must be between 01 and 12' };
  }

  if (year < 2000 || year > 2100) {
    return { valid: false, error: 'Year must be between 2000 and 2100' };
  }

  return { valid: true };
}

/** A month can be posted only after its last day has passed. */
export function periodHasEnded(period: string, today: Date = new Date()): boolean {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(year, month, 0);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return t.getTime() > lastDay.getTime();
}

const POSTED_STATUSES = ['posted', 'finalized', 'closed'];

/** Returns the refusal message when a posted month is not the latest posted month, otherwise null. */
export function latestPostedBlocker(docs: { period: string; status: string }[], target: { period: string; status: string }): string | null {
  if (!POSTED_STATUSES.includes(target.status)) return null;
  const latest = docs.filter((d) => POSTED_STATUSES.includes(d.status)).map((d) => d.period).sort().pop();
  if (!latest || target.period >= latest) return null;
  const [y, m] = latest.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return `Remove later months first (latest posted: ${label})`;
}

export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

export function getPreviousPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  const newYear = date.getFullYear();
  const newMonth = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${newYear}-${newMonth}`;
}

export function getNextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  const newYear = date.getFullYear();
  const newMonth = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${newYear}-${newMonth}`;
}

export function formatPeriodDisplay(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export function summarizeMonthEndTransactions(transactions: MonthEndTransaction[]): {
  totalLeases: number;
  totalTransactions: number;
  totalDebits: number;
  totalCredits: number;
  totalInterest: number;
  totalPayments: number;
  totalDepreciation: number;
  totalOperatingLeaseCost: number;
  totalShortTermLeaseCost: number;
} {
  const uniqueLeases = new Set(transactions.map(t => t.lease_id));

  return {
    totalLeases: uniqueLeases.size,
    totalTransactions: transactions.length,
    totalDebits: transactions.reduce((sum, t) => sum + t.debit_amount, 0),
    totalCredits: transactions.reduce((sum, t) => sum + t.credit_amount, 0),
    totalInterest: transactions
      .filter(t => t.transaction_type === 'interest')
      .reduce((sum, t) => sum + t.debit_amount, 0),
    totalPayments: transactions
      .filter(t => t.transaction_type === 'payment')
      .reduce((sum, t) => sum + t.debit_amount, 0),
    totalDepreciation: transactions
      .filter(t => t.transaction_type === 'amortization')
      .reduce((sum, t) => sum + t.debit_amount, 0),
    totalOperatingLeaseCost: transactions
      .filter(t => t.transaction_type === 'operating_lease_expense')
      .reduce((sum, t) => sum + t.debit_amount, 0),
    totalShortTermLeaseCost: transactions
      .filter(t => t.transaction_type === 'short_term_lease_expense')
      .reduce((sum, t) => sum + t.debit_amount, 0),
  };
}

export function formatCurrency(amount: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatCurrencyCompact(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  return parseLocalDate(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export function parseLocalDate(dateString: string): Date {
  const [y, m, d] = dateString.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Converts a Date to a YYYY-MM-DD string using LOCAL time components,
 * never UTC.  Using toISOString() shifts the date in time zones east
 * of UTC (e.g. a Date created as new Date(2026, 0, 1) in Asia/Yerevan
 * becomes 2025-12-31).  Every period_date / transaction_date written
 * anywhere in the app must go through this helper.
 */
export function toYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatBillingDate(ts: string | number | null): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

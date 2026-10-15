import type { Lease } from '../../types/lease';

export type ExpirationSortKey = 'lease_name' | 'lessor_name' | 'lease_end_date' | 'days_remaining';
export type SortDirection = 'asc' | 'desc';
export type ExpirationRowStatus = 'critical' | 'warning' | 'normal';
export type ExpirationCsvStatus = 'Expired' | 'Critical' | 'Warning' | 'Active';

export type ExpirationRow = Lease & { daysRemaining: number; endDate: Date };

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Returns a copy of `date` set to local midnight. */
export function startOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Parses a YYYY-MM-DD string as a local-midnight date. */
export function parseLeaseDate(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

/** Whole days (rounded up) from `today` to `endDate`. */
export function computeDaysRemaining(endDate: Date, today: Date): number {
  const diffMs = endDate.getTime() - today.getTime();
  return Math.ceil(diffMs / MS_PER_DAY);
}

/** Decorates each lease with its parsed end date and days remaining relative to `today` (local midnight). */
export function buildExpirationRows(leases: Lease[], today: Date): ExpirationRow[] {
  return leases.map(l => {
    const endDate = parseLeaseDate(l.lease_end_date);
    const daysRemaining = computeDaysRemaining(endDate, today);
    return { ...l, daysRemaining, endDate };
  });
}

/** Returns a new array sorted by the given key/direction. */
export function sortExpirationRows<T extends ExpirationRow>(rows: T[], sortKey: ExpirationSortKey, sortDir: SortDirection): T[] {
  return [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'lease_name': return a.lease_name.localeCompare(b.lease_name) * dir;
      case 'lessor_name': return a.lessor_name.localeCompare(b.lessor_name) * dir;
      case 'lease_end_date': return a.lease_end_date.localeCompare(b.lease_end_date) * dir;
      case 'days_remaining': return (a.daysRemaining - b.daysRemaining) * dir;
      default: return 0;
    }
  });
}

/** Flips a sort direction (used when the active column header is clicked again). */
export function toggleSortDirection(dir: SortDirection): SortDirection {
  return dir === 'asc' ? 'desc' : 'asc';
}

export function getRowStatus(daysRemaining: number): ExpirationRowStatus {
  if (daysRemaining <= 30) return 'critical';
  if (daysRemaining <= 60) return 'warning';
  return 'normal';
}

export function isExpired(daysRemaining: number): boolean {
  return daysRemaining <= 0;
}

export function countExpirationBuckets(rows: { daysRemaining: number }[]): {
  criticalCount: number;
  warningCount: number;
  expiredCount: number;
} {
  return {
    criticalCount: rows.filter(l => l.daysRemaining <= 30 && l.daysRemaining > 0).length,
    warningCount: rows.filter(l => l.daysRemaining > 30 && l.daysRemaining <= 60).length,
    expiredCount: rows.filter(l => l.daysRemaining <= 0).length,
  };
}

export function getCsvStatus(daysRemaining: number): ExpirationCsvStatus {
  return daysRemaining <= 0 ? 'Expired' : daysRemaining <= 30 ? 'Critical' : daysRemaining <= 60 ? 'Warning' : 'Active';
}

export const CONTRACT_EXPIRATION_CSV_HEADERS = ['Lease Name', 'Lessor', 'Classification', 'Start Date', 'End Date', 'Term (Months)', 'Monthly Payment', 'Days Remaining', 'Status'];

export function escapeCsvField(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`;
  return val;
}

export function buildContractExpirationCsvRow(l: ExpirationRow): string {
  return [
    l.lease_name,
    l.lessor_name,
    l.lease_classification,
    l.lease_start_date,
    l.lease_end_date,
    String(l.lease_term_months),
    Number(l.payment_amount).toFixed(2),
    String(l.daysRemaining),
    getCsvStatus(l.daysRemaining),
  ].map(escapeCsvField).join(',');
}

export function buildContractExpirationCsv(rows: ExpirationRow[]): string {
  return [CONTRACT_EXPIRATION_CSV_HEADERS.join(','), ...rows.map(buildContractExpirationCsvRow)].join('\n');
}

export function contractExpirationCsvFilename(now: Date): string {
  return `contract_expiration_report_${now.toISOString().split('T')[0]}.csv`;
}

export function formatExpirationDate(ymd: string): string {
  return parseLeaseDate(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatExpirationCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

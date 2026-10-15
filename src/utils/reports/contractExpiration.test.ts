import { describe, expect, it } from 'vitest';
import type { Lease } from '../../types/lease';
import {
  CONTRACT_EXPIRATION_CSV_HEADERS,
  buildContractExpirationCsv,
  buildContractExpirationCsvRow,
  buildExpirationRows,
  computeDaysRemaining,
  contractExpirationCsvFilename,
  countExpirationBuckets,
  escapeCsvField,
  formatExpirationCurrency,
  formatExpirationDate,
  getCsvStatus,
  getRowStatus,
  isExpired,
  parseLeaseDate,
  sortExpirationRows,
  startOfDay,
  toggleSortDirection,
  type ExpirationRow,
} from './contractExpiration';

const TODAY = new Date(2025, 5, 15); // Jun 15 2025, local midnight

function lease(overrides: Partial<Lease>): Lease {
  return {
    id: 'l1',
    lease_name: 'Lease',
    lessor_name: 'Lessor',
    lease_classification: 'operating',
    lease_start_date: '2024-01-01',
    lease_end_date: '2025-12-31',
    lease_term_months: 24,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    ...overrides,
  } as Lease;
}

function rows(leases: Lease[]): ExpirationRow[] {
  return buildExpirationRows(leases, TODAY);
}

describe('contractExpiration date helpers', () => {
  it('startOfDay zeroes the time without mutating the input', () => {
    const input = new Date(2025, 5, 15, 13, 45, 12, 500);
    const out = startOfDay(input);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
    expect(out.getDate()).toBe(15);
    expect(input.getHours()).toBe(13);
  });

  it('parseLeaseDate keeps the local calendar day', () => {
    const d = parseLeaseDate('2025-01-01');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('computeDaysRemaining counts whole days and goes negative after the end', () => {
    expect(computeDaysRemaining(parseLeaseDate('2025-06-15'), TODAY)).toBe(0);
    expect(computeDaysRemaining(parseLeaseDate('2025-06-16'), TODAY)).toBe(1);
    expect(computeDaysRemaining(parseLeaseDate('2025-07-15'), TODAY)).toBe(30);
    expect(computeDaysRemaining(parseLeaseDate('2025-06-10'), TODAY)).toBe(-5);
  });

  it('buildExpirationRows decorates leases with endDate and daysRemaining', () => {
    const [r] = rows([lease({ lease_end_date: '2025-06-25' })]);
    expect(r.daysRemaining).toBe(10);
    expect(r.endDate.getDate()).toBe(25);
    expect(r.lease_name).toBe('Lease');
  });
});

describe('contractExpiration sorting', () => {
  const data = rows([
    lease({ id: 'a', lease_name: 'Bravo', lessor_name: 'Zed', lease_end_date: '2025-08-01' }),
    lease({ id: 'b', lease_name: 'Alpha', lessor_name: 'Acme', lease_end_date: '2026-01-01' }),
    lease({ id: 'c', lease_name: 'Charlie', lessor_name: 'Mid', lease_end_date: '2025-06-01' }),
  ]);

  it('sorts by days remaining ascending and descending', () => {
    expect(sortExpirationRows(data, 'days_remaining', 'asc').map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortExpirationRows(data, 'days_remaining', 'desc').map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by lease name, lessor name and end date', () => {
    expect(sortExpirationRows(data, 'lease_name', 'asc').map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortExpirationRows(data, 'lessor_name', 'desc').map(r => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortExpirationRows(data, 'lease_end_date', 'asc').map(r => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the input array', () => {
    const before = data.map(r => r.id);
    sortExpirationRows(data, 'lease_name', 'asc');
    expect(data.map(r => r.id)).toEqual(before);
  });

  it('toggleSortDirection flips the direction', () => {
    expect(toggleSortDirection('asc')).toBe('desc');
    expect(toggleSortDirection('desc')).toBe('asc');
  });
});

describe('contractExpiration status and buckets', () => {
  it('getRowStatus uses 30/60 day thresholds', () => {
    expect(getRowStatus(-1)).toBe('critical');
    expect(getRowStatus(30)).toBe('critical');
    expect(getRowStatus(31)).toBe('warning');
    expect(getRowStatus(60)).toBe('warning');
    expect(getRowStatus(61)).toBe('normal');
  });

  it('isExpired is true at zero or below', () => {
    expect(isExpired(0)).toBe(true);
    expect(isExpired(-3)).toBe(true);
    expect(isExpired(1)).toBe(false);
  });

  it('getCsvStatus labels each band', () => {
    expect(getCsvStatus(0)).toBe('Expired');
    expect(getCsvStatus(1)).toBe('Critical');
    expect(getCsvStatus(30)).toBe('Critical');
    expect(getCsvStatus(31)).toBe('Warning');
    expect(getCsvStatus(60)).toBe('Warning');
    expect(getCsvStatus(61)).toBe('Active');
  });

  it('countExpirationBuckets excludes expired from critical', () => {
    const counts = countExpirationBuckets([-5, 0, 1, 30, 31, 60, 61].map(daysRemaining => ({ daysRemaining })));
    expect(counts).toEqual({ criticalCount: 2, warningCount: 2, expiredCount: 2 });
  });
});

describe('contractExpiration CSV', () => {
  it('escapes commas, quotes and newlines only when needed', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('builds a row in column order with fixed-2 payment and status', () => {
    const [r] = rows([lease({ lease_name: 'HQ, Floor 2', lease_end_date: '2025-07-01', payment_amount: 1234.5 })]);
    expect(buildContractExpirationCsvRow(r)).toBe('"HQ, Floor 2",Lessor,operating,2024-01-01,2025-07-01,24,1234.50,16,Critical');
  });

  it('builds the full CSV with header line and newline separators', () => {
    const data = rows([
      lease({ id: 'a', lease_name: 'A', lease_end_date: '2025-06-01' }),
      lease({ id: 'b', lease_name: 'B', lease_end_date: '2026-06-15', payment_amount: 50 }),
    ]);
    const csv = buildContractExpirationCsv(data);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(CONTRACT_EXPIRATION_CSV_HEADERS.join(','));
    expect(lines[0]).toBe('Lease Name,Lessor,Classification,Start Date,End Date,Term (Months),Monthly Payment,Days Remaining,Status');
    expect(lines[1]).toBe('A,Lessor,operating,2024-01-01,2025-06-01,24,1000.00,-14,Expired');
    expect(lines[2]).toBe('B,Lessor,operating,2024-01-01,2026-06-15,24,50.00,365,Active');
    expect(lines).toHaveLength(3);
  });

  it('builds a header-only CSV for no rows', () => {
    expect(buildContractExpirationCsv([])).toBe(CONTRACT_EXPIRATION_CSV_HEADERS.join(','));
  });

  it('names the file by ISO date', () => {
    expect(contractExpirationCsvFilename(new Date('2025-06-15T12:00:00Z'))).toBe('contract_expiration_report_2025-06-15.csv');
  });
});

describe('contractExpiration formatting', () => {
  it('formats dates as short US dates', () => {
    expect(formatExpirationDate('2025-01-05')).toBe('Jan 5, 2025');
  });

  it('formats currency in USD with cents', () => {
    expect(formatExpirationCurrency(1234.5)).toBe('$1,234.50');
  });
});

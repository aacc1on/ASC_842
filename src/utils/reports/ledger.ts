import type { Lease } from '../../types/lease';
import type { LeaseTransaction } from '../transactionGenerator';

export interface DetailedLedgerEntry {
  date: string;
  description: string;
  accountDebited: string;
  accountCredited: string;
  amount: number;
  entryType: string;
  leaseName?: string;
  branch?: string;
  assetType?: string;
}

export interface LedgerLookups {
  branches: { id: string; branch_name: string }[];
  assetTypes: { id: string; type_name: string }[];
}

const ENTRY_TYPE_ALIASES: Record<string, string> = {
  initial_recognition: 'Initial Recognition',
  payment: 'Lease Payment',
  lease_payment: 'Lease Payment',
  interest: 'Interest Accrual',
  interest_accrual: 'Interest Accrual',
  interest_expense: 'Interest Accrual',
  amortization: 'Depreciation',
  depreciation: 'Depreciation',
  depreciation_expense: 'Depreciation',
  operating_lease_expense: 'Operating Lease Expense',
  month_end_catch_up: 'Month-End Catch-Up',
  modification: 'Modification',
  remeasurement: 'Remeasurement',
  termination: 'Termination',
  lease_cancellation: 'Lease Cancellation',
  derecognition: 'Derecognition',
  prepayment: 'Prepayment',
};

export function normalizeEntryType(rawType: string): string {
  const key = (rawType || '').toLowerCase();
  return ENTRY_TYPE_ALIASES[key] || rawType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

interface LedgerSourceRow {
  lease_id: string;
  transaction_date: string;
  description: string;
  account_debited: string;
  account_credited: string;
  transaction_type: string;
  leases?: { lease_name?: string } | null;
}

function toEntry(
  txn: LedgerSourceRow,
  amount: number,
  leaseMap: Map<string, Lease>,
  branchMap: Map<string, string>,
  assetTypeMap: Map<string, string>,
): DetailedLedgerEntry {
  const lease = leaseMap.get(txn.lease_id);
  return {
    date: txn.transaction_date,
    description: txn.description,
    accountDebited: txn.account_debited,
    accountCredited: txn.account_credited,
    amount,
    entryType: normalizeEntryType(txn.transaction_type),
    leaseName: txn.leases?.lease_name || lease?.lease_name || '',
    branch: lease?.branch_id ? branchMap.get(lease.branch_id) || '' : '',
    assetType: lease?.fixed_asset_type_id ? assetTypeMap.get(lease.fixed_asset_type_id) || '' : '',
  };
}

const lookupMaps = (lookups: LedgerLookups) => ({
  branchMap: new Map(lookups.branches.map((b) => [b.id, b.branch_name])),
  assetTypeMap: new Map(lookups.assetTypes.map((t) => [t.id, t.type_name])),
});

/** Lease-event rows (lease_transactions) use `amount`. */
export function buildLeaseEventEntries(storedTxns: LeaseTransaction[], leases: Lease[], lookups: LedgerLookups): DetailedLedgerEntry[] {
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const { branchMap, assetTypeMap } = lookupMaps(lookups);
  return storedTxns
    .map((txn) => toEntry(txn as unknown as LedgerSourceRow, txn.amount, leaseMap, branchMap, assetTypeMap))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Posted ledger rows (transactions) use `debit_amount`, falling back to `amount`. */
export type PostedLedgerRow = LedgerSourceRow & { debit_amount?: number | null; amount?: number | null };

export function buildPostedEntries(
  rows: PostedLedgerRow[],
  leases: Lease[],
  lookups: LedgerLookups,
): DetailedLedgerEntry[] {
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const { branchMap, assetTypeMap } = lookupMaps(lookups);
  return rows.map((txn) => toEntry(txn, txn.debit_amount ?? txn.amount ?? 0, leaseMap, branchMap, assetTypeMap));
}

export function mergeLedgerEntries(...groups: DetailedLedgerEntry[][]): DetailedLedgerEntry[] {
  return groups.flat().sort((a, b) => a.date.localeCompare(b.date));
}

export function buildLedgerCsv(entries: DetailedLedgerEntry[]): string {
  const headers = ['Date', 'Lease Name', 'Branch', 'Asset Type', 'Entry Type', 'Description', 'Account Debited', 'Account Credited', 'Amount'];
  const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
  const rows = entries.map((entry) => {
    const dateObj = new Date(entry.date + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    return [escapeCsv(formattedDate), escapeCsv(entry.leaseName || ''), escapeCsv(entry.branch || ''), escapeCsv(entry.assetType || ''), escapeCsv(entry.entryType), escapeCsv(entry.description), escapeCsv(entry.accountDebited), escapeCsv(entry.accountCredited), entry.amount.toFixed(2)].join(',');
  });
  const totalRow = ['"TOTAL"', '""', '""', '""', '""', `"${entries.length} entries"`, '""', '""', entries.reduce((s, e) => s + e.amount, 0).toFixed(2)].join(',');
  return [headers.join(','), ...rows, totalRow].join('\n');
}

export const LEDGER_KNOWN_TYPES = ['Initial Recognition', 'Lease Payment', 'Interest Accrual', 'Depreciation'];

export interface LedgerSliceSummary {
  count: number;
  total: number;
  byType: (t: string) => number;
  other: number;
}

export function summarizeLedgerSlice(ledger: DetailedLedgerEntry[], start: string, end: string): LedgerSliceSummary {
  const entries = ledger.filter((e) => e.date >= start && e.date <= end);
  return {
    count: entries.length,
    total: entries.reduce((s, e) => s + e.amount, 0),
    byType: (t: string) => entries.filter((e) => e.entryType === t).reduce((s, e) => s + e.amount, 0),
    other: entries.filter((e) => !LEDGER_KNOWN_TYPES.includes(e.entryType)).reduce((s, e) => s + e.amount, 0),
  };
}

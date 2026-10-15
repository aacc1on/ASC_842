export interface DetailedLedgerEntry {
  date: string;
  description: string;
  accountDebited: string;
  accountCredited: string;
  amount: number;
  entryType: string;
  leaseName: string;
  branch: string;
  assetType: string;
}

const FORMULA_PREFIXES = /^[=+\-@\t\r]/;

export function exportToCsv(filename: string, headers: string[], rows: (string | number | null)[][]): void {
  const escape = (val: string | number | null): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (FORMULA_PREFIXES.test(s)) {
      const safe = `'${s}`;
      if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
        return `"${safe.replace(/"/g, '""')}"`;
      }
      return safe;
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function sanitizeCellForExcel(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (FORMULA_PREFIXES.test(s)) {
    return `'${s}`;
  }
  return s;
}

export function downloadLedgerCSV(entries: DetailedLedgerEntry[], periodStart: string, periodEnd: string): void {
  const headers = ['Date', 'Entry Type', 'Description', 'Account Debited', 'Account Credited', 'Amount', 'Lease Name', 'Branch', 'Asset Type'];
  const rows = entries.map((e) => [
    e.date,
    e.entryType,
    e.description,
    e.accountDebited,
    e.accountCredited,
    e.amount,
    e.leaseName,
    e.branch,
    e.assetType,
  ]);
  exportToCsv(`transaction-ledger-${periodStart}-to-${periodEnd}.csv`, headers, rows);
}

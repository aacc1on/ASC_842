import { formatDate } from './formatting';
import { sanitizeCellForExcel } from './csvExport';
import type { DashboardGroup, LeaseDashboardRow, LeaseDashboardTotals } from './leaseDashboard';

type SheetRow = Record<string, string | number>;

function leaseLine(r: LeaseDashboardRow): SheetRow {
  return {
    Type: r.type === 'finance' ? 'Finance' : 'Operating',
    'Lease name': sanitizeCellForExcel(r.name),
    Branch: sanitizeCellForExcel(r.branchName),
    'Start date': formatDate(r.startDate),
    'End date': formatDate(r.endDate),
    'Term (months)': r.termMonths,
    'Months remaining': r.monthsRemaining,
    'Monthly lease payment': r.monthlyLease,
    'Monthly non-lease amount': r.monthlyNonlease ?? '—',
    'Total lease amount (term)': r.totalLease,
    'Total non-lease amount (term)': r.totalNonlease ?? '—',
  };
}

function totalLine(label: string, t: LeaseDashboardTotals): SheetRow {
  return {
    Type: label,
    'Lease name': `${t.count} ${t.count === 1 ? 'lease' : 'leases'}`,
    Branch: '', 'Start date': '', 'End date': '', 'Term (months)': '', 'Months remaining': '',
    'Monthly lease payment': t.monthlyLease,
    'Monthly non-lease amount': t.monthlyNonlease,
    'Total lease amount (term)': t.totalLease,
    'Total non-lease amount (term)': t.totalNonlease,
  };
}

export function leaseDashboardSheetRows(groups: DashboardGroup[], grand: LeaseDashboardTotals): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    rows.push(...g.rows.map(leaseLine), totalLine(`${g.label} subtotal`, g.totals));
  }
  rows.push(totalLine('Grand total', grand));
  return rows;
}

export async function downloadLeaseDashboardExcel(groups: DashboardGroup[], grand: LeaseDashboardTotals): Promise<void> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.json_to_sheet(leaseDashboardSheetRows(groups, grand));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lease Dashboard');
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(workbook, `lease_dashboard_${stamp}.xlsx`);
}

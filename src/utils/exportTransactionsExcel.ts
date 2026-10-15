import type { Transaction } from '../components/transactions/types';
import { formatCurrency, formatDate } from './formatting';
import { sanitizeCellForExcel } from './csvExport';

/**
 * Download the provided transactions as an Excel (.xlsx) file.
 *
 * `xlsx` is imported dynamically so it is only loaded when the user actually
 * exports, keeping the main bundle smaller.
 */
export async function downloadExcel(transactions: Transaction[]): Promise<void> {
  if (!transactions || transactions.length === 0) {
    return;
  }

  const XLSX = await import('xlsx');

  const rows = transactions.map((t) => ({
    Date: sanitizeCellForExcel(formatDate(t.transaction_date)),
    Period: sanitizeCellForExcel(t.period || ''),
    Type: sanitizeCellForExcel(t.transaction_type),
    Lease: sanitizeCellForExcel(t.lease_name || ''),
    'Account Debited': sanitizeCellForExcel(t.account_debited),
    'Account Credited': sanitizeCellForExcel(t.account_credited),
    Debit: t.debit_amount,
    Credit: t.credit_amount,
    Reference: sanitizeCellForExcel(t.reference_number),
    Description: sanitizeCellForExcel(t.description),
    Branch: sanitizeCellForExcel(t.branch_name || ''),
    Reversed: t.is_reversed ? 'Yes' : 'No',
    'Debit (formatted)': formatCurrency(t.debit_amount),
    'Credit (formatted)': formatCurrency(t.credit_amount),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(workbook, `transactions_${stamp}.xlsx`);
}

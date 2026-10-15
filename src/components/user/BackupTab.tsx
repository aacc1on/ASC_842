import { Database, Download, RefreshCw, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import type { BackupCounts } from '../../hooks/useBackup';

interface BackupTabProps {
  backupLoading: boolean;
  backupCounts: BackupCounts | null;
  backupCountsLoading: boolean;
  lastBackupAt: string | null;
  backupMessage: string;
  onDownload: () => void;
  onRefreshCounts: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function BackupTab({
  backupLoading,
  backupCounts,
  backupCountsLoading,
  lastBackupAt,
  backupMessage,
  onDownload,
  onRefreshCounts,
}: BackupTabProps) {
  const counts = backupCounts
    ? [
        { label: 'Leases', value: backupCounts.leases },
        { label: 'Amortization Schedules', value: backupCounts.amortization_schedules },
        { label: 'Payment Schedules', value: backupCounts.lease_payment_schedules },
        { label: 'Transactions', value: backupCounts.transactions },
        { label: 'Lease Transactions', value: backupCounts.lease_transactions },
        { label: 'Journal Entries', value: backupCounts.journal_entries },
        { label: 'Contract Modifications', value: backupCounts.contract_modifications },
        { label: 'Contract Cancellations', value: backupCounts.contract_cancellations },
        { label: 'Lease Modifications', value: backupCounts.lease_modifications },
        { label: 'Lease Impairments', value: backupCounts.lease_impairments },
        { label: 'Policy Elections', value: backupCounts.accounting_policy_elections },
        { label: 'Lessors', value: backupCounts.lessors },
        { label: 'Branches', value: backupCounts.branches },
        { label: 'Fixed Asset Types', value: backupCounts.fixed_asset_types },
        { label: 'Documents', value: backupCounts.documents },
        { label: 'Month-End Documents', value: backupCounts.month_end_documents },
        { label: 'Accounting Periods', value: backupCounts.accounting_periods },
        { label: 'Audit Log', value: backupCounts.audit_log },
      ]
    : [];

  const isSuccess = backupMessage.toLowerCase().includes('success') || backupMessage.toLowerCase().includes('begin');
  const totalRows = counts.reduce((s, c) => s + c.value, 0);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Data Backup</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Download a snapshot of your organization's lease accounting data. Backups include
            leases, schedules, transactions, journal entries, modifications, cancellations, impairments, policy elections, lessors, branches, asset types, documents, month-end documents, accounting periods, and audit log.
          </p>
        </div>
        <button
          onClick={onRefreshCounts}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${backupCountsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
          <FileText className="w-6 h-6 text-slate-500 mb-3" />
          <p className="text-sm text-slate-500">Total Records</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {backupCountsLoading ? '…' : totalRows.toLocaleString()}
          </p>
        </div>
        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
          <Database className="w-6 h-6 text-slate-500 mb-3" />
          <p className="text-sm text-slate-500">Last Backup</p>
          <p className="text-base font-bold text-slate-900 mt-1">{formatDateTime(lastBackupAt)}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
          <Download className="w-6 h-6 text-slate-500 mb-3" />
          <p className="text-sm text-slate-500">Format</p>
          <p className="text-base font-bold text-slate-900 mt-1">JSON Archive</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-800">Record Counts by Table</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {backupCountsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          ) : counts.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500 text-sm">
              No counts available. Click Refresh to load.
            </div>
          ) : (
            counts.map((c) => (
              <div key={c.label} className="flex items-center justify-between px-6 py-3">
                <span className="text-sm font-medium text-slate-700">{c.label}</span>
                <span className="text-sm font-bold text-slate-900">{c.value.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <button
          onClick={onDownload}
          disabled={backupLoading}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-5 h-5" />
          {backupLoading ? 'Generating backup...' : 'Download Backup'}
        </button>

        {backupMessage && (
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              isSuccess
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {isSuccess ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {backupMessage}
          </div>
        )}
      </div>
    </div>
  );
}

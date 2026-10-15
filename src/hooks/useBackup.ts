import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getErrorMessage, SESSION_EXPIRED_MESSAGE, UserFacingError } from '../utils/errors';
import { edgeFunctionError } from '../utils/edgeFunctionError';
import { currentOrgId } from '../utils/currentOrg';

export interface BackupCounts {
  leases: number;
  amortization_schedules: number;
  lease_payment_schedules: number;
  transactions: number;
  lease_transactions: number;
  journal_entries: number;
  contract_modifications: number;
  contract_cancellations: number;
  lease_modifications: number;
  lease_impairments: number;
  accounting_policy_elections: number;
  lessors: number;
  branches: number;
  fixed_asset_types: number;
  documents: number;
  month_end_documents: number;
  accounting_periods: number;
  audit_log: number;
}

interface UseBackupArgs {
  userEmail?: string;
}

interface UseBackupResult {
  backupLoading: boolean;
  backupCounts: BackupCounts | null;
  backupCountsLoading: boolean;
  lastBackupAt: string | null;
  backupMessage: string;
  handleDownloadBackup: () => Promise<void>;
  loadBackupCounts: () => Promise<void>;
}

const TABLES: Array<{ key: keyof BackupCounts; table: string }> = [
  { key: 'leases', table: 'leases' },
  { key: 'amortization_schedules', table: 'amortization_schedules' },
  { key: 'lease_payment_schedules', table: 'lease_payment_schedules' },
  { key: 'transactions', table: 'transactions' },
  { key: 'lease_transactions', table: 'lease_transactions' },
  { key: 'journal_entries', table: 'journal_entries' },
  { key: 'contract_modifications', table: 'contract_modifications' },
  { key: 'contract_cancellations', table: 'contract_cancellations' },
  { key: 'lease_modifications', table: 'lease_modifications' },
  { key: 'lease_impairments', table: 'lease_impairments' },
  { key: 'accounting_policy_elections', table: 'accounting_policy_elections' },
  { key: 'lessors', table: 'lessors' },
  { key: 'branches', table: 'branches' },
  { key: 'fixed_asset_types', table: 'fixed_asset_types' },
  { key: 'documents', table: 'documents' },
  { key: 'month_end_documents', table: 'month_end_documents' },
  { key: 'accounting_periods', table: 'accounting_periods' },
  { key: 'audit_log', table: 'audit_log' },
];

const EMPTY_COUNTS: BackupCounts = {
  leases: 0,
  amortization_schedules: 0,
  lease_payment_schedules: 0,
  transactions: 0,
  lease_transactions: 0,
  journal_entries: 0,
  contract_modifications: 0,
  contract_cancellations: 0,
  lease_modifications: 0,
  lease_impairments: 0,
  accounting_policy_elections: 0,
  lessors: 0,
  branches: 0,
  fixed_asset_types: 0,
  documents: 0,
  month_end_documents: 0,
  accounting_periods: 0,
  audit_log: 0,
};

export function useBackup(_args?: UseBackupArgs): UseBackupResult {
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCounts, setBackupCounts] = useState<BackupCounts | null>(null);
  const [backupCountsLoading, setBackupCountsLoading] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState('');

  const loadBackupCounts = useCallback(async () => {
    setBackupCountsLoading(true);
    setBackupMessage('');
    try {
      const counts = { ...EMPTY_COUNTS };
      const orgId = await currentOrgId();
      for (const { key, table } of TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId);
        if (error) {
          counts[key] = 0;
        } else {
          counts[key] = count ?? 0;
        }
      }
      setBackupCounts(counts);
    } catch {
      setBackupCounts(null);
    } finally {
      setBackupCountsLoading(false);
    }
  }, []);

  const handleDownloadBackup = useCallback(async () => {
    setBackupLoading(true);
    setBackupMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/export-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw edgeFunctionError(res, data, 'The backup could not be created. Please try again.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupMessage('Backup downloaded successfully.');
      setLastBackupAt(new Date().toISOString());
    } catch (err) {
      setBackupMessage(getErrorMessage(err));
    } finally {
      setBackupLoading(false);
    }
  }, []);

  return {
    backupLoading,
    backupCounts,
    backupCountsLoading,
    lastBackupAt,
    backupMessage,
    handleDownloadBackup,
    loadBackupCounts,
  };
}

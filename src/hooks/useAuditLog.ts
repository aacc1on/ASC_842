import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';

export interface AuditLogRow {
  id: number;
  organization_id: string;
  actor_user_id: string | null;
  table_name: string;
  record_id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
}

export interface AuditLogFilters {
  dateFrom: string;
  dateTo: string;
  tableName: string;
  actorUserId: string;
}

export const AUDIT_TABLES = [
  'leases',
  'lease_transactions',
  'transactions',
  'lease_modifications',
  'contract_modifications',
  'contract_cancellations',
  'lease_impairments',
  'month_end_documents',
  'accounting_periods',
  'branches',
  'companies',
  'user_profiles',
] as const;

interface AuditLogUser {
  user_id: string;
  email: string;
}

export interface AuditLogRowWithLabel extends AuditLogRow {
  record_label: string;
}

const TABLE_LABEL_CONFIG: Record<string, { column: string; label: string }> = {
  leases: { column: 'lease_name', label: 'Lease' },
  lease_transactions: { column: 'transaction_type', label: 'Transaction' },
  transactions: { column: 'transaction_type', label: 'Transaction' },
  lease_modifications: { column: 'reason', label: 'Modification' },
  contract_modifications: { column: 'reason', label: 'Modification' },
  contract_cancellations: { column: 'reason', label: 'Cancellation' },
  lease_impairments: { column: 'reason', label: 'Impairment' },
  month_end_documents: { column: 'period_label', label: 'Month-End' },
  accounting_periods: { column: 'period_label', label: 'Accounting Period' },
  branches: { column: 'branch_name', label: 'Branch' },
  companies: { column: 'company_name', label: 'Company' },
  user_profiles: { column: 'email', label: 'User' },
};

export function resolveRecordLabel(
  tableName: string,
  recordId: string,
  resolved: Map<string, string>
): string {
  const key = `${tableName}:${recordId}`;
  const label = resolved.get(key);
  if (label) return label;
  const config = TABLE_LABEL_CONFIG[tableName];
  if (!config) return recordId.slice(0, 8);
  return `(deleted ${config.label.toLowerCase()})`;
}

async function resolveRecordIds(
  rows: AuditLogRow[],
  orgId: string
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const idsByTable = new Map<string, Set<string>>();

  for (const row of rows) {
    const config = TABLE_LABEL_CONFIG[row.table_name];
    if (!config) continue;
    if (!idsByTable.has(row.table_name)) idsByTable.set(row.table_name, new Set());
    idsByTable.get(row.table_name)!.add(row.record_id);
  }

  const tableToDbTable: Record<string, string> = {
    lease_transactions: 'lease_transactions',
    transactions: 'lease_transactions',
    lease_modifications: 'contract_modifications',
    contract_cancellations: 'contract_modifications',
    accounting_periods: 'month_end_documents',
  };

  const promises: Promise<void>[] = [];

  for (const [auditTable, ids] of idsByTable) {
    const dbTable = tableToDbTable[auditTable] ?? auditTable;
    const config = TABLE_LABEL_CONFIG[auditTable];
    const idArray = [...ids];

    promises.push(
      (async () => {
        try {
          const { data, error } = await supabase
            .from(dbTable)
            .select(`id, ${config.column}`)
            .eq('organization_id', orgId)
            .in('id', idArray);

          if (error || !data) return;

          const rows = data as unknown as Record<string, unknown>[];
          for (const row of rows) {
            const label = row[config.column];
            const rowId = row['id'] as string;
            if (label && rowId) {
              resolved.set(`${auditTable}:${rowId}`, String(label));
            }
          }
        } catch {
          // silent — unresolved IDs will show as "(deleted ...)"
        }
      })()
    );
  }

  await Promise.all(promises);
  return resolved;
}

export function useAuditLog() {
  const [rows, setRows] = useState<AuditLogRowWithLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<AuditLogUser[]>([]);
  const [recordLabels, setRecordLabels] = useState<Map<string, string>>(new Map());
  const filtersRef = useRef<AuditLogFilters>({ dateFrom: '', dateTo: '', tableName: '', actorUserId: '' });

  const loadUsers = useCallback(async () => {
    try {
      const orgId = await currentOrgId();
      const { data, error: userError } = await supabase
        .from('user_profiles')
        .select('user_id, email')
        .eq('organization_id', orgId)
        .order('email');
      if (userError) return;
      if (data) setUsers(data as AuditLogUser[]);
    } catch {
      // silent
    }
  }, []);

  const loadAuditLogs = useCallback(async (filters: AuditLogFilters) => {
    filtersRef.current = filters;
    setLoading(true);
    setError('');
    try {
      const orgId = await currentOrgId();
      let query = supabase
        .from('audit_log')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (filters.tableName) {
        query = query.eq('table_name', filters.tableName);
      }
      if (filters.actorUserId) {
        query = query.eq('actor_user_id', filters.actorUserId);
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom + 'T00:00:00');
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59');
      }

      const { data, error: queryError } = await query;
      if (queryError) {
        setError(toUserMessage(queryError));
        return;
      }

      const rawRows = (data as AuditLogRow[]) ?? [];

      const labels = await resolveRecordIds(rawRows, orgId);
      setRecordLabels(labels);

      const enriched = rawRows.map((row) => ({
        ...row,
        record_label: resolveRecordLabel(row.table_name, row.record_id, labels),
      }));

      setRows(enriched);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load audit logs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  return {
    rows,
    loading,
    error,
    users,
    recordLabels,
    loadAuditLogs,
    loadUsers,
  };
}

import { supabase } from '../lib/supabase';
import { fetchAllRpc } from './fetchAll';

export type ReconciliationCheckType =
  | 'missing_posting'
  | 'posted_vs_schedule'
  | 'posted_vs_journal'
  | 'events_vs_journal'
  | 'unbalanced_journal_entry'
  | 'unbalanced_posted_entry';

export interface ReconciliationDifference {
  checkType: ReconciliationCheckType;
  leaseId: string | null;
  leaseName: string | null;
  period: string | null;
  account: string | null;
  posted: number;
  expected: number;
  difference: number;
}

export interface DataHealthIssue {
  organizationId: string | null;
  organizationName: string | null;
  checkKey: string;
  leaseId: string | null;
  leaseName: string | null;
  detail: string;
}

export const RECONCILIATION_LABELS: Record<ReconciliationCheckType, string> = {
  missing_posting: 'Lease-month with no posting',
  posted_vs_schedule: 'Posted vs. amortization schedule',
  posted_vs_journal: 'Posted vs. projected journal',
  events_vs_journal: 'Lease events vs. projected journal',
  unbalanced_journal_entry: 'Unbalanced journal entry',
  unbalanced_posted_entry: 'Unbalanced posted entry',
};

export const DATA_HEALTH_LABELS: Record<string, string> = {
  lease_without_schedule: 'Lease without amortization schedule',
  schedule_not_ending_at_zero: 'Schedule does not end at zero',
  orphan_row: 'Row linked to another organization',
  unbalanced_journal_entry: 'Unbalanced journal entry',
  finance_lease_missing_inputs: 'Finance lease missing fair value / useful life',
  initial_recognition_mismatch: 'Initial recognition differs from lease liability',
  organization_without_owner: 'Organization without an admin',
  subscription_without_owner: 'Subscription without an owner',
  subscription_without_organization: 'Subscription without an organization',
};

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function asRows(data: unknown, what: string): Row[] {
  if (data == null) return [];
  if (!Array.isArray(data)) throw new Error(`Failed to load ${what}: unexpected response`);
  return data.filter((r): r is Row => typeof r === 'object' && r !== null);
}

export async function fetchLedgerReconciliation(
  from: string,
  to: string,
  includePreparedCatchUp = false,
): Promise<ReconciliationDifference[]> {
  const rows = await fetchAllRpc<Row>(
    'ledger reconciliation',
    () => supabase.rpc('get_ledger_reconciliation', {
      p_from: from,
      p_to: to,
      p_include_prepared_catch_up: includePreparedCatchUp,
    }),
    ['check_type', 'lease_id', 'period', 'account'],
    (data) => asRows(data, 'ledger reconciliation'),
  );
  return rows.map((r) => ({
    checkType: (str(r.check_type) ?? 'posted_vs_journal') as ReconciliationCheckType,
    leaseId: str(r.lease_id),
    leaseName: str(r.lease_name),
    period: str(r.period),
    account: str(r.account),
    posted: num(r.posted),
    expected: num(r.expected),
    difference: num(r.difference),
  }));
}

function toIssue(r: Row): DataHealthIssue {
  return {
    organizationId: str(r.organization_id),
    organizationName: str(r.organization_name),
    checkKey: str(r.check_key) ?? 'unknown',
    leaseId: str(r.lease_id),
    leaseName: str(r.lease_name),
    detail: str(r.detail) ?? '',
  };
}

export async function fetchDataHealth(scope: 'organization' | 'platform'): Promise<DataHealthIssue[]> {
  const fn = scope === 'platform' ? 'get_platform_data_health' : 'get_data_health';
  const orderBy = scope === 'platform'
    ? ['organization_id', 'check_key', 'lease_id', 'detail']
    : ['check_key', 'lease_id', 'detail'];
  const rows = await fetchAllRpc<Row>('data health', () => supabase.rpc(fn), orderBy, (data) => asRows(data, 'data health'));
  return rows.map(toIssue);
}

import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import { applyModification, applyCancellation, applyImpairment } from './leaseModification';
import { currentOrgId } from './currentOrg';

export type ApprovalItemType =
  | 'policy_election'
  | 'contract_modification'
  | 'contract_cancellation'
  | 'impairment'
  | 'month_end';

export type ApproverRole = 'admin' | 'manage';

export interface ApprovalSettings {
  organization_id: string;
  enabled: boolean;
  require_different_approver: boolean;
  approver_role: ApproverRole;
  item_types: ApprovalItemType[];
  updated_at: string;
}

export interface PendingApproval {
  item_type: ApprovalItemType;
  item_id: string;
  title: string;
  summary: string;
  amount: number | null;
  prepared_by: string | null;
  prepared_by_name: string;
  prepared_at: string;
}

export const APPROVAL_ITEM_TYPES: { key: ApprovalItemType; label: string; description: string }[] = [
  { key: 'policy_election', label: 'Accounting policy elections', description: 'New or changed elections in Accounting Policies' },
  { key: 'contract_modification', label: 'Contract modifications', description: 'Payment, term and rate changes to leases' },
  { key: 'contract_cancellation', label: 'Cancellations', description: 'Early terminations and derecognition' },
  { key: 'impairment', label: 'Impairments', description: 'ROU asset impairment charges' },
  { key: 'month_end', label: 'Month-end finalization', description: 'Posting month-end journal entries' },
];

export const APPROVAL_ITEM_LABEL: Record<ApprovalItemType, string> = {
  policy_election: 'Policy election',
  contract_modification: 'Modification',
  contract_cancellation: 'Cancellation',
  impairment: 'Impairment',
  month_end: 'Month-end',
};

const TABLE: Record<ApprovalItemType, string> = {
  policy_election: 'accounting_policy_elections',
  contract_modification: 'contract_modifications',
  contract_cancellation: 'contract_cancellations',
  impairment: 'lease_impairments',
  month_end: 'month_end_documents',
};

export function approvedStatus(type: ApprovalItemType): string {
  return type === 'month_end' ? 'posted' : 'approved';
}

export function pendingStatus(type: ApprovalItemType): string {
  return type === 'month_end' ? 'pending' : 'pending_approval';
}

async function loadLease(leaseId: string): Promise<Lease> {
  const orgId = await currentOrgId();
  const { data, error } = await supabase.from('leases').select('*').eq('organization_id', orgId).eq('id', leaseId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Lease not found for this item.');
  return data as Lease;
}

async function loadRow(type: ApprovalItemType, id: string): Promise<Record<string, unknown>> {
  const orgId = await currentOrgId();
  const { data, error } = await supabase
    .from(TABLE[type])
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Item not found.');
  return data as Record<string, unknown>;
}

/** Posts the ledger impact of an approved item. Safe to call twice: already-posted items are skipped. */
export async function postItemAccounting(type: ApprovalItemType, id: string): Promise<void> {
  if (type === 'policy_election' || type === 'month_end') return;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? '';
  const row = await loadRow(type, id);

  if (type === 'contract_modification') {
    if (row.accounting_posted) return;
    const lease = await loadLease(String(row.lease_id));
    await applyModification(
      id,
      lease,
      String(row.modification_date),
      Number(row.new_monthly_payment) || 0,
      Number(row.new_lease_term) || 0,
      Number(row.new_discount_rate ?? row.old_discount_rate ?? lease.discount_rate ?? lease.incremental_borrowing_rate ?? 0),
      userId,
      Boolean(row.separate_contract),
      (row.fair_value_at_modification as number | null) ?? null,
      (row.remaining_economic_life_months as number | null) ?? null,
    );
  } else if (type === 'contract_cancellation') {
    if (row.derecognition_posted) return;
    const lease = await loadLease(String(row.lease_id));
    await applyCancellation(
      id,
      lease,
      String(row.cancellation_date),
      Number(row.termination_penalty) || 0,
      Number(row.final_payment_amount) || 0,
      userId,
    );
  } else {
    if (row.posted) return;
    const lease = await loadLease(String(row.lease_id));
    await applyImpairment(id, lease, String(row.impairment_date), Number(row.impairment_amount) || 0, String(row.reason ?? ''), userId);
  }
}

/** After a save: if the database made the item effective immediately, post its accounting now. Returns true when it is awaiting approval. */
export async function finalizeSavedItem(type: ApprovalItemType, id: string, savedStatus: string | null | undefined): Promise<boolean> {
  if (savedStatus === approvedStatus(type)) {
    await postItemAccounting(type, id);
    return false;
  }
  return savedStatus === pendingStatus(type);
}

export const PROTECTED_EDIT_FIELDS = ['user_id', 'organization_id', 'status', 'prepared_by', 'approved_by', 'approved_at', 'self_approved'] as const;

/**
 * Saves a content edit without touching owner, organization or status, then
 * resubmits a rejected (draft) item with a separate status-only update.
 */
export async function saveItemEdit(
  type: Exclude<ApprovalItemType, 'month_end' | 'policy_election'>,
  id: string,
  content: Record<string, unknown>,
  currentStatus: string | null | undefined,
): Promise<{ id: string; status: string }> {
  const leaked = PROTECTED_EDIT_FIELDS.filter((f) => f in content);
  if (leaked.length) throw new Error(`Edit payload must not include ${leaked.join(', ')}`);
  const { data, error } = await supabase.from(TABLE[type]).update(content).eq('id', id).select('id, status').single();
  if (error) throw error;
  const saved = data as { id: string; status: string };
  if (currentStatus !== 'draft') return saved;
  const { data: resubmitted, error: resubmitError } = await supabase
    .from(TABLE[type])
    .update({ status: pendingStatus(type) })
    .eq('id', id)
    .select('id, status')
    .single();
  if (resubmitError) throw resubmitError;
  return resubmitted as { id: string; status: string };
}

export async function approveItem(type: ApprovalItemType, id: string): Promise<void> {
  const { data: reason, error } = await supabase.rpc('check_approval_permission', { p_item_type: type, p_item_id: id });
  if (error) throw error;
  if (reason) throw new Error(String(reason));
  await postItemAccounting(type, id);
  const { error: updateError } = await supabase.from(TABLE[type]).update({ status: approvedStatus(type) }).eq('id', id);
  if (updateError) throw updateError;
}

export async function rejectItem(type: ApprovalItemType, id: string, comment: string): Promise<void> {
  const trimmed = comment.trim();
  if (!trimmed) throw new Error('A comment is required to reject an item.');
  const { error } = await supabase.from(TABLE[type]).update({ status: 'draft', rejection_comment: trimmed }).eq('id', id);
  if (error) throw error;
}

export async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const { data, error } = await supabase.rpc('get_pending_approvals');
  if (error) throw error;
  return Array.isArray(data) ? (data as PendingApproval[]) : [];
}

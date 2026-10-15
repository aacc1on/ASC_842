import { supabase } from '../lib/supabase';
import { toUserMessage } from './errors';
import { parseLocalDate } from './formatting';
import { currentOrgId } from './currentOrg';

export interface JournalRefreshResult {
  kept_locked: number;
  deleted: number;
  inserted: number;
  posted_through: string | null;
}

export type JournalRefreshOutcome =
  | { ok: true; result: JournalRefreshResult; message: string }
  | { ok: false; message: string };

export function lockEndFor(postedThrough: string | null): string | null {
  if (!postedThrough) return null;
  const d = parseLocalDate(postedThrough);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  return `${last.getFullYear()}-${mm}-${dd}`;
}

export function entriesAfterLock<T extends { entry_date: string }>(entries: T[], lockEnd: string | null): T[] {
  if (!lockEnd) return entries;
  return entries.filter((e) => e.entry_date.split('T')[0] > lockEnd);
}

export function refreshToastMessage(result: JournalRefreshResult): string {
  if (result.posted_through && result.kept_locked > 0) {
    const month = parseLocalDate(result.posted_through).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `Posted entries through ${month} are locked; entries after that were refreshed.`;
  }
  return 'Journal entries refreshed.';
}

function isRefreshResult(value: unknown): value is JournalRefreshResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.kept_locked === 'number' && typeof v.deleted === 'number' && typeof v.inserted === 'number';
}

const FALLBACK = 'Could not refresh journal entries. Please try again.';

export async function refreshLeaseJournal<T extends { entry_date: string }>(
  leaseId: string,
  entries: T[],
): Promise<JournalRefreshOutcome> {
  let orgId: string;
  try {
    orgId = await currentOrgId();
  } catch (err) {
    return { ok: false, message: toUserMessage(err, FALLBACK) };
  }
  const { data: postedThrough, error: postedError } = await supabase.rpc('get_lease_posted_through', {
    p_lease_id: leaseId,
  });
  if (postedError) return { ok: false, message: toUserMessage(postedError, FALLBACK) };

  const lockEnd = lockEndFor((postedThrough as string | null) ?? null);
  let payload = entries;
  if (lockEnd) {
    const { count, error: countError } = await supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('lease_id', leaseId)
      .lte('entry_date', lockEnd);
    if (countError) return { ok: false, message: toUserMessage(countError, FALLBACK) };
    // Locked history can be filled once while empty; afterwards it is never resent.
    if ((count ?? 0) > 0) payload = entriesAfterLock(entries, lockEnd);
  }

  const { data, error } = await supabase.rpc('refresh_lease_journal_entries', {
    p_lease_id: leaseId,
    p_entries: payload,
  });
  if (error) return { ok: false, message: toUserMessage(error, FALLBACK) };
  if (!isRefreshResult(data)) return { ok: false, message: FALLBACK };

  const result: JournalRefreshResult = { ...data, posted_through: data.posted_through ?? null };
  return { ok: true, result, message: refreshToastMessage(result) };
}

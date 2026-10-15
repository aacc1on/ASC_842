import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import type { Lease, JournalEntry, AmortizationSchedule } from '../types/lease';
import { refreshLeaseJournal } from '../utils/journalRefresh';
import { fetchAll } from '../utils/fetchAll';
import { buildLeaseJournalEntries, type ApprovedModification } from '../utils/leaseJournalBuild';
import { useToast } from '../components/toastContextTypes';

const loadLeaseJournal = (orgId: string, leaseId: string) =>
  fetchAll<JournalEntry>('journal entries', (from, to) => supabase
    .from('journal_entries')
    .select('*')
    .eq('organization_id', orgId)
    .eq('lease_id', leaseId)
    .order('entry_date', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));

export function useLeaseJournal(lease: Lease) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [postedMonths, setPostedMonths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { showToast } = useToast();

  const orgId = lease.organization_id;

  useEffect(() => {
    let cancelled = false;
    fetchAll<{ transaction_date: string }>('posting status', (from, to) => supabase
      .from('transactions')
      .select('transaction_date')
      .eq('organization_id', orgId)
      .eq('lease_id', lease.id)
      .not('month_end_document_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to))
      .then(
        (data) => {
          if (!cancelled) setPostedMonths(new Set(data.map((r) => String(r.transaction_date).slice(0, 7))));
        },
        () => {
          if (!cancelled) showToast('error', 'Could not load posting status. All entries are shown as projected.');
        },
      );
    return () => {
      cancelled = true;
    };
  }, [lease.id, orgId, showToast]);

  const runGenerate = useCallback(async (initialLoad: boolean) => {
    setGenerating(true);
    setLoading(true);
    setError(null);
    let stage: 'schedule' | 'journal' = 'schedule';
    try {
      const [schedule, modificationsResult] = await Promise.all([
        fetchAll<AmortizationSchedule>('lease schedule', (from, to) => supabase
          .from('amortization_schedules')
          .select('*')
          .eq('organization_id', orgId)
          .eq('lease_id', lease.id)
          .order('period_number', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)),
        supabase
          .from('contract_modifications')
          .select('*')
          .eq('organization_id', orgId)
          .eq('lease_id', lease.id)
          .eq('status', 'approved')
          .order('modification_date', { ascending: true }),
      ]);
      if (modificationsResult.error) throw modificationsResult.error;

      const approvedMods: ApprovedModification[] = modificationsResult.data ?? [];

      const allEntries = buildLeaseJournalEntries(lease, schedule, approvedMods);
      const outcome = await refreshLeaseJournal(lease.id, allEntries);
      showToast(outcome.ok ? 'success' : 'error', outcome.message);

      stage = 'journal';
      setEntries(await loadLeaseJournal(orgId, lease.id));
    } catch (err) {
      if (initialLoad) {
        setError(toUserMessage(err, 'Could not load the journal entries for this lease.'));
      } else {
        showToast('error', stage === 'schedule'
          ? 'Could not load the lease schedule to build journal entries.'
          : 'Could not load journal entries.');
      }
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [lease, orgId, showToast]);

  const generateEntries = useCallback(() => runGenerate(false), [runGenerate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      let data: JournalEntry[];
      try {
        data = await loadLeaseJournal(orgId, lease.id);
      } catch (err) {
        if (cancelled) return;
        setEntries([]);
        setError(toUserMessage(err, 'Could not load the journal entries for this lease.'));
        setLoading(false);
        return;
      }
      if (cancelled) return;
      if (data.length === 0) {
        runGenerate(true);
        return;
      }
      const hasModEntries = data.some((e) => e.entry_type === 'Lease Modification');
      if (!hasModEntries) {
        const { count } = await supabase
          .from('contract_modifications')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('lease_id', lease.id)
          .eq('status', 'approved');
        if (cancelled) return;
        if (count && count > 0) {
          runGenerate(true);
          return;
        }
      }
      setEntries(data as JournalEntry[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [lease.id, orgId, runGenerate, attempt]);

  return { entries, loading, error, retry, generating, postedMonths, generateEntries };
}

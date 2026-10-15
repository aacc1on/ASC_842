import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { toUserMessage } from '../../utils/errors';
import { currentOrgId } from '../../utils/currentOrg';

export interface CatchUpBatch {
  id: string;
  lease_id: string;
  lease_name: string;
  description: string;
  first_missed_period: string;
  last_missed_period: string;
  missed_months: number;
  total_interest: number;
  total_amortization: number;
  total_payment: number;
  total_debits: number;
  total_credits: number;
  status: 'prepared' | 'posted';
}

export function useCatchUpBatches(period: string) {
  const [batches, setBatches] = useState<CatchUpBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      setBatches([]);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    currentOrgId()
      .then((orgId) => fetchAll<Omit<CatchUpBatch, 'lease_name'> & { leases: unknown }>('catch-up corrections', (from, to) => supabase
        .from('month_end_catch_up_batches')
        .select('id, lease_id, description, first_missed_period, last_missed_period, missed_months, total_interest, total_amortization, total_payment, total_debits, total_credits, status, leases:lease_id (lease_name)')
        .eq('organization_id', orgId)
        .eq('posting_period', period)
        .order('id')
        .range(from, to)))
      .then((rows) => {
        if (cancelled) return;
        const mapped = rows.map(({ leases, ...b }) => {
          const lease = (Array.isArray(leases) ? leases[0] : leases) as { lease_name?: string } | null;
          return { ...b, lease_name: lease?.lease_name ?? 'Unknown lease' };
        });
        mapped.sort((a, b) => a.lease_name.localeCompare(b.lease_name));
        setBatches(mapped);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBatches([]);
        setError(toUserMessage(err, 'The catch-up corrections could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, attempt]);

  return { batches, loading, error, retry };
}

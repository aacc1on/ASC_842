import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';

export interface ErrorLogRow {
  id: number;
  organization_id: string | null;
  user_id: string | null;
  message: string;
  stack: string | null;
  route: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ErrorLogFilters {
  dateFrom: string;
  dateTo: string;
  route: string;
}

export function useErrorLog() {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const filtersRef = useRef<ErrorLogFilters>({ dateFrom: '', dateTo: '', route: '' });

  const loadErrorLogs = useCallback(async (filters: ErrorLogFilters) => {
    filtersRef.current = filters;
    setLoading(true);
    setError('');
    try {
      const orgId = await currentOrgId();
      let query = supabase
        .from('error_logs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (filters.route) {
        query = query.ilike('route', `%${filters.route}%`);
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
      setRows((data as ErrorLogRow[]) ?? []);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load error logs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadErrorLogs({ dateFrom: '', dateTo: '', route: '' });
  }, [loadErrorLogs]);

  return {
    rows,
    loading,
    error,
    loadErrorLogs,
  };
}

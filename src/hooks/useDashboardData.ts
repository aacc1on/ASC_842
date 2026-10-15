import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import { toUserMessage } from '../utils/errors';

interface UseDashboardDataArgs {
  /**
   * Called when the user id lookup fails so the component can surface a toast.
   * Optional to keep the hook decoupled from UI concerns.
   */
  onUserError?: () => void;
  /**
   * Called after a successful delete so the component can reload its lease
   * list. Kept as a callback because lease reloading in the component
   * depends on local filter/pagination state the hook does not own.
   */
  onDeleted?: () => void;
}

interface UseDashboardDataResult {
  userId: string;
  leases: Lease[];
  loading: boolean;
  error: string;
  handleDelete: (id: string) => Promise<void>;
  /** Borrowed by the component for the paginated lease query it still owns. */
  setLeases: React.Dispatch<React.SetStateAction<Lease[]>>;
  /** Borrowed by the component for the paginated lease query it still owns. */
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Extracts the Supabase data-loading/saving logic from Dashboard.tsx:
 *  - supabase.auth.getUser() to resolve the current user id
 *  - supabase.from('leases').delete() for lease deletion
 *
 * The hook intentionally does NOT own the complex paginated lease list query
 * (which depends on the component's filter/sort/pagination state) or the
 * branches query; those remain in the component to avoid churning unrelated
 * behavior. The component drives `leases`/`loading` via the borrowed setters
 * for the query it still owns.
 */
export function useDashboardData({
  onUserError,
  onDeleted,
}: UseDashboardDataArgs = {}): UseDashboardDataResult {
  const [userId, setUserId] = useState('');
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Keep the latest onDeleted without re-running the delete callback identity.
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  // Resolve the current user id once on mount.
  useEffect(() => {
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (active && data?.user) setUserId(data.user.id);
      })
      .catch(() => {
        if (active) onUserError?.();
      });
    return () => {
      active = false;
    };
  }, [onUserError]);

  const handleDelete = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase
        .from('leases')
        .delete()
        .eq('id', id);
      if (deleteError) {
        setError(toUserMessage(deleteError, 'Failed to delete lease. Please try again.'));
        setTimeout(() => setError(''), 8000);
      } else {
        onDeletedRef.current?.();
      }
    },
    [],
  );

  return {
    userId,
    leases,
    loading,
    error,
    handleDelete,
    setLeases,
    setLoading,
  };
}

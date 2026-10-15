import { useCallback, useEffect, useState, type DependencyList } from 'react';
import { toUserMessage } from '../utils/errors';

export interface AsyncData<T> {
  data: T;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Runs `load` whenever `deps` change (or `retry` is called). Results of a superseded or unmounted
 * request are dropped, loading always ends, and failures become a user-facing message.
 * Pass `null` as the loader to skip loading and reset to `initial`.
 */
export function useAsyncData<T>(
  load: (() => Promise<T>) | null,
  deps: DependencyList,
  initial: T,
  fallbackMessage: string,
): AsyncData<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(load !== null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let stale = false;
    setError(null);
    if (!load) {
      setData(initial);
      setLoading(false);
      return;
    }
    setLoading(true);
    load()
      .then((value) => { if (!stale) setData(value); })
      .catch((err) => {
        if (stale) return;
        setData(initial);
        setError(toUserMessage(err, fallbackMessage));
      })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // `load` is rebuilt each render; `deps` are what decide when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { data, loading, error, retry };
}

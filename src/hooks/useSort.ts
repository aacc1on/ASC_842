import { useCallback, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface UseSortResult<K extends string> {
  sortKey: K;
  sortDir: SortDir;
  handleSort: (key: K) => void;
}

/**
 * Generic sorting hook for table columns.
 *
 * `defaultDirForKey` determines the initial direction when switching to a new
 * column. When the same column header is clicked again the direction flips.
 */
export function useSort<K extends string>(
  initialKey: K,
  initialDir: SortDir,
  defaultDirForKey?: (key: K) => SortDir,
): UseSortResult<K> {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const handleSort = useCallback(
    (key: K) => {
      if (key === sortKey) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(defaultDirForKey ? defaultDirForKey(key) : 'asc');
      }
    },
    [sortKey, defaultDirForKey],
  );

  return { sortKey, sortDir, handleSort };
}

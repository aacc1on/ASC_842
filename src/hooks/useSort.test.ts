import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSort, type SortDir } from './useSort';

type Key = 'name' | 'amount' | 'date';

describe('useSort', () => {
  it('starts with the initial key and direction', () => {
    const { result } = renderHook(() => useSort<Key>('date', 'desc'));
    expect(result.current.sortKey).toBe('date');
    expect(result.current.sortDir).toBe('desc');
  });

  it('flips direction when the active column is clicked again', () => {
    const { result } = renderHook(() => useSort<Key>('name', 'asc'));
    act(() => result.current.handleSort('name'));
    expect(result.current).toMatchObject({ sortKey: 'name', sortDir: 'desc' });
    act(() => result.current.handleSort('name'));
    expect(result.current).toMatchObject({ sortKey: 'name', sortDir: 'asc' });
  });

  it('switches to a new column with ascending order when no default function is given', () => {
    const { result } = renderHook(() => useSort<Key>('date', 'desc'));
    act(() => result.current.handleSort('amount'));
    expect(result.current).toMatchObject({ sortKey: 'amount', sortDir: 'asc' });
  });

  it('uses defaultDirForKey for a newly selected column, then toggles from there', () => {
    const defaultDir = vi.fn((k: Key): SortDir => (k === 'amount' || k === 'date' ? 'desc' : 'asc'));
    const { result } = renderHook(() => useSort<Key>('name', 'asc', defaultDir));

    act(() => result.current.handleSort('amount'));
    expect(defaultDir).toHaveBeenCalledWith('amount');
    expect(result.current).toMatchObject({ sortKey: 'amount', sortDir: 'desc' });

    act(() => result.current.handleSort('amount'));
    expect(result.current.sortDir).toBe('asc');
    expect(defaultDir).toHaveBeenCalledTimes(1);

    act(() => result.current.handleSort('name'));
    expect(result.current).toMatchObject({ sortKey: 'name', sortDir: 'asc' });
  });

  it('keeps handleSort referentially stable until the key changes', () => {
    const { result } = renderHook(() => useSort<Key>('name', 'asc'));
    const first = result.current.handleSort;
    act(() => result.current.handleSort('name'));
    expect(result.current.handleSort).toBe(first);
    act(() => result.current.handleSort('date'));
    expect(result.current.handleSort).not.toBe(first);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsyncData } from './useAsyncData';
import { UserFacingError } from '../utils/errors';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useAsyncData', () => {
  it('starts loading, then exposes the data', async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.resolve(5), [], 0, 'Failed.'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(5);
    expect(result.current.error).toBeNull();
  });

  it('returns the initial value without loading when there is nothing to load', () => {
    const { result } = renderHook(() => useAsyncData<number>(null, [], 7, 'Failed.'));
    expect(result.current).toMatchObject({ data: 7, loading: false, error: null });
  });

  it('shows a clear error, resets the data, and recovers on retry', async () => {
    const load = vi.fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new UserFacingError('Too many requests.'))
      .mockResolvedValueOnce(3);
    const { result } = renderHook(() => useAsyncData(load, [], 0, 'Failed to load.'));
    await waitFor(() => expect(result.current.data).toBe(1));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe('Too many requests.'));
    expect(result.current.data).toBe(0);
    expect(result.current.loading).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBe(3));
    expect(result.current.error).toBeNull();
  });

  it('uses the fallback message for unknown errors', async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.reject(new Error('xyz internal')), [], 0, 'Failed to load.'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load.');
  });

  it('ignores a slower response for inputs that have since changed', async () => {
    const slow = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }) => useAsyncData(() => (key === 'a' ? slow.promise : Promise.resolve('b')), [key], '', 'Failed.'),
      { initialProps: { key: 'a' } },
    );
    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.data).toBe('b'));
    await act(async () => { slow.resolve('a'); await slow.promise; });
    expect(result.current.data).toBe('b');
    expect(result.current.loading).toBe(false);
  });

  it('does not update after unmount', async () => {
    const slow = deferred<number>();
    const { result, unmount } = renderHook(() => useAsyncData(() => slow.promise, [], 0, 'Failed.'));
    unmount();
    await act(async () => { slow.reject(new Error('late')); await slow.promise.catch(() => {}); });
    expect(result.current.loading).toBe(true);
  });
});

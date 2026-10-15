import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIdleTimeout } from './useIdleTimeout';

const MIN = 60 * 1000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('useIdleTimeout', () => {
  it('warns 2 minutes before the 30 minute timeout, then times out', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onTimeout));
    expect(result.current.showWarning).toBe(false);

    advance(28 * MIN - 1);
    expect(result.current.showWarning).toBe(false);
    advance(1);
    expect(result.current.showWarning).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();

    advance(2 * MIN);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(result.current.showWarning).toBe(false);

    advance(60 * MIN);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it.each(['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'])('resets the timers on %s activity', (evt) => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout(onTimeout));
    advance(29 * MIN);
    act(() => { window.dispatchEvent(new Event(evt)); });
    advance(29 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();
    advance(1 * MIN);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('activity during the warning hides it', () => {
    const { result } = renderHook(() => useIdleTimeout(vi.fn()));
    advance(28 * MIN);
    expect(result.current.showWarning).toBe(true);
    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(result.current.showWarning).toBe(false);
  });

  it('dismissWarning hides the warning and restarts the full idle window', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onTimeout));
    advance(29 * MIN);
    expect(result.current.showWarning).toBe(true);
    act(() => result.current.dismissWarning());
    expect(result.current.showWarning).toBe(false);
    advance(29 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();
    advance(1 * MIN);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resetTimers restarts the idle window', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onTimeout));
    advance(20 * MIN);
    act(() => result.current.resetTimers());
    advance(20 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(result.current.showWarning).toBe(false);
  });

  it('calls the latest onTimeout callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useIdleTimeout(cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    advance(30 * MIN);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clears timers and listeners on unmount', () => {
    const onTimeout = vi.fn();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdleTimeout(onTimeout));
    unmount();
    expect(removeSpy.mock.calls.map((c) => c[0]).sort())
      .toEqual(['keydown', 'mousedown', 'mousemove', 'scroll', 'touchstart']);
    advance(60 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

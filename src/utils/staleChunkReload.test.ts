import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForStaleChunk } from './staleChunkReload';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('stale chunk reload', () => {
  it('recognises dynamic-import failures', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
    expect(isChunkLoadError(new Error('Network down'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('reloads once, then refuses within the guard window', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(storage, reload, 1_000_000)).toBe(true);
    expect(reloadOnceForStaleChunk(storage, reload, 1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForStaleChunk(storage, reload, 1_061_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when storage is unavailable (prevents loops)', () => {
    const reload = vi.fn();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(reloadOnceForStaleChunk(broken, reload, 5)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

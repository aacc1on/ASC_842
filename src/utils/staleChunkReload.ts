import { lazy, type ComponentType } from 'react';

// After a deploy, old chunk URLs 404. Reload at most once per minute so a chunk
// that is still missing after the reload surfaces the error instead of looping.
const RELOAD_GUARD_KEY = 'vite_reload_at';
const RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR.test(message);
}

export function reloadOnceForStaleChunk(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  now: number = Date.now(),
): boolean {
  let last = 0;
  try {
    last = Number(storage.getItem(RELOAD_GUARD_KEY) || 0);
  } catch {
    return false;
  }
  if (now - last < RELOAD_WINDOW_MS) return false;
  try {
    storage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own constraint
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy<T>(() =>
    factory().catch((error: unknown): Promise<{ default: T }> => {
      if (isChunkLoadError(error) && reloadOnceForStaleChunk()) {
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }),
  );
}

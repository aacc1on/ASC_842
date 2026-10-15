import { useEffect, useRef, useState, useCallback } from 'react';

const IDLE_MS = 30 * 60 * 1000;
const WARNING_MS = 2 * 60 * 1000;
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove',
];

export function useIdleTimeout(onTimeout: () => void) {
  const [showWarning, setShowWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const resetTimers = useCallback(() => {
    if (warningRef.current) clearTimeout(warningRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowWarning(false);
    warningRef.current = setTimeout(() => setShowWarning(true), IDLE_MS - WARNING_MS);
    timerRef.current = setTimeout(() => {
      setShowWarning(false);
      onTimeoutRef.current();
    }, IDLE_MS);
  }, []);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    resetTimers();
  }, [resetTimers]);

  useEffect(() => {
    resetTimers();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetTimers, { passive: true });
    }
    return () => {
      if (warningRef.current) clearTimeout(warningRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetTimers);
      }
    };
  }, [resetTimers]);

  return { showWarning, dismissWarning, resetTimers };
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TurnstileHandle } from '../../components/TurnstileWidget';
import { nextToken, turnstileMock } from './turnstileMockState';

export const MockTurnstileWidget = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(
  function MockTurnstileWidget({ onToken }, ref) {
    const onTokenRef = useRef(onToken);
    useEffect(() => {
      onTokenRef.current = onToken;
    }, [onToken]);

    useImperativeHandle(ref, () => ({
      reset() {
        turnstileMock.resets += 1;
        onTokenRef.current(null);
        if (turnstileMock.autoSolve) onTokenRef.current(nextToken());
      },
    }), []);

    useEffect(() => {
      if (turnstileMock.autoSolve) onTokenRef.current(nextToken());
    }, []);

    return (
      <div role="group" aria-label="Security check">
        <button type="button" onClick={() => onTokenRef.current(nextToken())}>
          Solve security check
        </button>
      </div>
    );
  },
);

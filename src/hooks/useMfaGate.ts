import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkMfaGate } from '../utils/mfaGate';
import { toUserMessage } from '../utils/errors';

export type MfaGateState = 'idle' | 'checking' | 'pass' | 'challenge' | 'error';

export interface UseMfaGateResult {
  state: MfaGateState;
  error: string;
  verifying: boolean;
  verify: (code: string) => Promise<void>;
  retry: () => void;
}

/** Decides whether the signed-in user must complete a second sign-in step (TOTP) before using the app. */
export function useMfaGate(userId: string | null): UseMfaGateResult {
  const [state, setState] = useState<MfaGateState>('idle');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const run = useCallback(async () => {
    const id = ++requestRef.current;
    if (!userId) {
      setState('idle');
      return;
    }
    setState('checking');
    setError('');
    try {
      const decision = await checkMfaGate(supabase.auth.mfa);
      if (id !== requestRef.current) return;
      if (decision.status === 'challenge') {
        setFactorId(decision.factorId);
        setState('challenge');
      } else {
        setState('pass');
      }
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(toUserMessage(err, 'We could not check your sign-in security settings.'));
      setState('error');
    }
  }, [userId]);

  useEffect(() => {
    const requests = requestRef;
    void run();
    return () => {
      requests.current++;
    };
  }, [run]);

  const verify = useCallback(async (code: string) => {
    if (!factorId) return;
    setVerifying(true);
    setError('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (verifyError) throw verifyError;
      await run();
    } catch (err) {
      setError(toUserMessage(err, 'That code did not work. Check your authenticator app and try again.'));
    } finally {
      setVerifying(false);
    }
  }, [factorId, run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  return { state, error, verifying, verify, retry };
}

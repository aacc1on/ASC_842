import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getErrorMessage } from '../utils/errors';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

export interface LegalStatus {
  accepted: boolean;
  has_prior_acceptance: boolean;
  terms_accepted?: boolean;
  privacy_accepted?: boolean;
}

export type LegalGateState = 'idle' | 'loading' | 'required' | 'pass' | 'error';

export type PendingLegalDocs = 'both' | 'terms' | 'privacy';

export interface UseLegalStatusResult {
  state: LegalGateState;
  error: string | null;
  submitting: boolean;
  pending: PendingLegalDocs;
  accept: () => Promise<void>;
  retry: () => void;
}

function isLegalStatus(value: unknown): value is LegalStatus {
  return !!value && typeof value === 'object'
    && typeof (value as LegalStatus).accepted === 'boolean'
    && typeof (value as LegalStatus).has_prior_acceptance === 'boolean';
}

const STALE_VERSION_MESSAGE = 'These terms have been updated. Please reload the page and review the latest version.';

function isStaleVersionError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.includes('have been updated');
}

export function pendingDocs(status: LegalStatus | null): PendingLegalDocs {
  if (!status?.has_prior_acceptance) return 'both';
  if (status.terms_accepted === true && status.privacy_accepted === false) return 'privacy';
  if (status.privacy_accepted === true && status.terms_accepted === false) return 'terms';
  return 'both';
}

export function useLegalStatus(userId: string | null): UseLegalStatusResult {
  const [state, setState] = useState<LegalGateState>('idle');
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setState('idle');
      setStatus(null);
      return;
    }
    let cancelled = false;
    setState('loading');
    setError(null);
    supabase.rpc('my_legal_status').then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError || !isLegalStatus(data)) {
        setError(rpcError ? getErrorMessage(rpcError) : 'We could not check your agreement status.');
        setState('error');
        return;
      }
      setStatus(data);
      setState(data.accepted ? 'pass' : 'required');
    });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const accept = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('accept_legal_documents', {
        p_terms_version: TERMS_VERSION,
        p_privacy_version: PRIVACY_VERSION,
        p_source: status?.has_prior_acceptance ? 'reaccept' : 'invite',
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
      if (rpcError) throw rpcError;
      if (!isLegalStatus(data) || !data.accepted) {
        throw new Error('Your acceptance could not be recorded. Please reload the page and try again.');
      }
      setStatus(data);
      setState('pass');
    } catch (err) {
      setError(isStaleVersionError(err) ? STALE_VERSION_MESSAGE : getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [status]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  return { state, error, submitting, pending: pendingDocs(status), accept, retry };
}

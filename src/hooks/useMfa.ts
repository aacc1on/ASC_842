import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import { decideMfaGate } from '../utils/mfaGate';

interface MFAFactor {
  id: string;
  status: 'verified' | 'unverified';
  friendly_name: string;
  factor_type: 'totp';
}

interface UseMfaResult {
  factors: MFAFactor[];
  loading: boolean;
  error: string;
  enrollQrUrl: string | null;
  enrollSecret: string | null;
  enrollFactorId: string | null;
  verifyCode: string;
  setVerifyCode: (v: string) => void;
  needsAal2: boolean;
  loadFactors: () => Promise<void>;
  startEnroll: () => Promise<void>;
  verifyEnroll: () => Promise<void>;
  cancelEnroll: () => void;
  unenroll: (factorId: string) => Promise<void>;
}

export function useMfa(): UseMfaResult {
  const [factors, setFactors] = useState<MFAFactor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrollQrUrl, setEnrollQrUrl] = useState<string | null>(null);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [needsAal2, setNeedsAal2] = useState(false);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const totpFactors = (data?.totp || []).map((f) => ({
        id: f.id,
        status: f.status as 'verified' | 'unverified',
        friendly_name: f.friendly_name || 'Authenticator App',
        factor_type: 'totp' as const,
      }));
      setFactors(totpFactors);

      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      setNeedsAal2(decideMfaGate(aal, totpFactors).status === 'challenge');
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load MFA factors'));
    } finally {
      setLoading(false);
    }
  }, []);

  const startEnroll = useCallback(async () => {
    setError('');
    setEnrollQrUrl(null);
    setEnrollSecret(null);
    setEnrollFactorId(null);
    setVerifyCode('');
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'Lease Accountant',
      });
      if (enrollError) throw enrollError;
      setEnrollQrUrl(data?.totp.qr_code || null);
      setEnrollSecret(data?.totp.secret || null);
      setEnrollFactorId(data?.id || null);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to start MFA enrollment'));
    }
  }, []);

  const verifyEnroll = useCallback(async () => {
    if (!enrollFactorId || !verifyCode) return;
    setError('');
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollFactorId,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollFactorId,
        challengeId: challengeData.id,
        code: verifyCode,
      });
      if (verifyError) throw verifyError;
      setEnrollQrUrl(null);
      setEnrollSecret(null);
      setEnrollFactorId(null);
      setVerifyCode('');
      await loadFactors();
    } catch (err) {
      setError(toUserMessage(err, 'Failed to verify code'));
    }
  }, [enrollFactorId, verifyCode, loadFactors]);

  const cancelEnroll = useCallback(() => {
    setEnrollQrUrl(null);
    setEnrollSecret(null);
    setEnrollFactorId(null);
    setVerifyCode('');
    setError('');
  }, []);

  const unenroll = useCallback(async (factorId: string) => {
    setError('');
    try {
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unenrollErr) throw unenrollErr;
      await loadFactors();
    } catch (err) {
      setError(toUserMessage(err, 'Failed to remove MFA factor'));
    }
  }, [loadFactors]);

  return {
    factors,
    loading,
    error,
    enrollQrUrl,
    enrollSecret,
    enrollFactorId,
    verifyCode,
    setVerifyCode,
    needsAal2,
    loadFactors,
    startEnroll,
    verifyEnroll,
    cancelEnroll,
    unenroll,
  };
}

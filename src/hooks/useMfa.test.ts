import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMfa } from './useMfa';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
const fail = (message: string, code?: string) => Promise.resolve({ data: null, error: { message, code } });

let mfa: {
  listFactors: ReturnType<typeof vi.fn>;
  enroll: ReturnType<typeof vi.fn>;
  challenge: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  unenroll: ReturnType<typeof vi.fn>;
  getAuthenticatorAssuranceLevel: ReturnType<typeof vi.fn>;
};
let getSession: ReturnType<typeof vi.fn>;

const verified = { id: 'f1', status: 'verified', friendly_name: 'Phone', factor_type: 'totp' };
const pending = { id: 'f2', status: 'unverified', friendly_name: '', factor_type: 'totp' };

beforeEach(() => {
  mfa = {
    listFactors: vi.fn(() => ok({ totp: [], all: [] })),
    enroll: vi.fn(() => ok({ id: 'new-f', type: 'totp', totp: { qr_code: 'data:image/svg+xml;qr', secret: 'SECRET', uri: 'otpauth://' } })),
    challenge: vi.fn(() => ok({ id: 'ch-1' })),
    verify: vi.fn(() => ok({})),
    unenroll: vi.fn(() => ok({ id: 'f1' })),
    getAuthenticatorAssuranceLevel: vi.fn(() => ok({ currentLevel: 'aal1', nextLevel: 'aal1' })),
  };
  getSession = vi.fn(() => ok({ session: { user: { id: 'u1' }, access_token: 't' } }));
  h.client = { auth: { mfa, getSession } };
});

describe('useMfa – loadFactors', () => {
  it('starts empty and not loading', () => {
    const { result } = renderHook(() => useMfa());
    expect(result.current.factors).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.needsAal2).toBe(false);
  });

  it('loads TOTP factors, defaulting the friendly name', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [verified, pending] }));
    mfa.getAuthenticatorAssuranceLevel.mockReturnValue(ok({ currentLevel: 'aal2', nextLevel: 'aal2' }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.factors).toEqual([
      { id: 'f1', status: 'verified', friendly_name: 'Phone', factor_type: 'totp' },
      { id: 'f2', status: 'unverified', friendly_name: 'Authenticator App', factor_type: 'totp' },
    ]);
    expect(result.current.needsAal2).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('flags needsAal2 when a verified factor exists and the session is not aal2', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [verified] }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.needsAal2).toBe(true);
  });

  it('does not need aal2 with only unverified factors', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [pending] }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.needsAal2).toBe(false);
  });

  it('handles a null data payload and a missing session', async () => {
    mfa.listFactors.mockReturnValue(ok(null));
    getSession.mockReturnValue(ok(null));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.factors).toEqual([]);
    expect(result.current.needsAal2).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('reads the level from getAuthenticatorAssuranceLevel, not the session user', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [verified] }));
    getSession.mockReturnValue(ok({ session: { user: { id: 'u1', aal_level: 'aal2' } } }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(result.current.needsAal2).toBe(true);
  });

  it('reports an assurance-level error', async () => {
    mfa.getAuthenticatorAssuranceLevel.mockReturnValue(fail('internal'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.error).toBe('Failed to load MFA factors');
  });

  it('reports a list error with the fallback message', async () => {
    mfa.listFactors.mockReturnValue(fail('internal'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.error).toBe('Failed to load MFA factors');
    expect(result.current.loading).toBe(false);
  });

  it('maps a network failure to the connection message', async () => {
    mfa.listFactors.mockRejectedValue(new Error('Network request failed'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.loadFactors(); });
    expect(result.current.error).toBe('We could not reach the server. Check your internet connection and try again.');
  });
});

describe('useMfa – enrollment', () => {
  it('startEnroll requests a TOTP factor and exposes QR/secret/id', async () => {
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', issuer: 'Lease Accountant' });
    expect(result.current.enrollQrUrl).toBe('data:image/svg+xml;qr');
    expect(result.current.enrollSecret).toBe('SECRET');
    expect(result.current.enrollFactorId).toBe('new-f');
  });

  it('startEnroll tolerates empty enroll payload fields', async () => {
    mfa.enroll.mockReturnValue(ok({ id: '', totp: { qr_code: '', secret: '' } }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    expect(result.current.enrollQrUrl).toBeNull();
    expect(result.current.enrollSecret).toBeNull();
    expect(result.current.enrollFactorId).toBeNull();
  });

  it('startEnroll reports enroll errors', async () => {
    mfa.enroll.mockReturnValue(fail('boom'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    expect(result.current.error).toBe('Failed to start MFA enrollment');
    expect(result.current.enrollFactorId).toBeNull();
  });

  it('verifyEnroll is a no-op without factor id or code', async () => {
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.verifyEnroll(); });
    await act(async () => { await result.current.startEnroll(); });
    await act(async () => { await result.current.verifyEnroll(); });
    expect(mfa.challenge).not.toHaveBeenCalled();
  });

  it('verifyEnroll challenges, verifies, clears enrollment state and reloads factors', async () => {
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    act(() => result.current.setVerifyCode('123456'));
    mfa.listFactors.mockReturnValue(ok({ totp: [{ ...verified, id: 'new-f' }] }));
    await act(async () => { await result.current.verifyEnroll(); });
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'new-f' });
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'new-f', challengeId: 'ch-1', code: '123456' });
    expect(result.current.enrollQrUrl).toBeNull();
    expect(result.current.enrollSecret).toBeNull();
    expect(result.current.enrollFactorId).toBeNull();
    expect(result.current.verifyCode).toBe('');
    expect(result.current.factors.map((f) => f.id)).toEqual(['new-f']);
  });

  it('verifyEnroll reports challenge errors', async () => {
    mfa.challenge.mockReturnValue(fail('x'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    act(() => result.current.setVerifyCode('000000'));
    await act(async () => { await result.current.verifyEnroll(); });
    expect(result.current.error).toBe('Failed to verify code');
    expect(mfa.verify).not.toHaveBeenCalled();
    expect(result.current.enrollFactorId).toBe('new-f');
  });

  it('verifyEnroll reports a wrong code', async () => {
    mfa.verify.mockReturnValue(fail('Invalid TOTP code entered', 'mfa_verification_failed'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    act(() => result.current.setVerifyCode('999999'));
    await act(async () => { await result.current.verifyEnroll(); });
    expect(result.current.error).toBe('Invalid TOTP code entered');
    expect(result.current.verifyCode).toBe('999999');
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });

  it('cancelEnroll clears enrollment state and error', async () => {
    mfa.enroll.mockReturnValueOnce(ok({ id: 'new-f', totp: { qr_code: 'q', secret: 's' } }));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.startEnroll(); });
    act(() => result.current.setVerifyCode('12'));
    act(() => result.current.cancelEnroll());
    expect(result.current.enrollQrUrl).toBeNull();
    expect(result.current.enrollSecret).toBeNull();
    expect(result.current.enrollFactorId).toBeNull();
    expect(result.current.verifyCode).toBe('');
    expect(result.current.error).toBe('');
  });
});

describe('useMfa – unenroll', () => {
  it('unenrolls and reloads factors', async () => {
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.unenroll('f1'); });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.listFactors).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('');
  });

  it('reports unenroll errors without reloading', async () => {
    mfa.unenroll.mockReturnValue(fail('AAL2 required'));
    const { result } = renderHook(() => useMfa());
    await act(async () => { await result.current.unenroll('f1'); });
    expect(result.current.error).toBe('Failed to remove MFA factor');
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });
});

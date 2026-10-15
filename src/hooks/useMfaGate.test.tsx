import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMfaGate } from './useMfaGate';
import { MfaChallenge } from '../components/MfaChallenge';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
const fail = (message: string) => Promise.resolve({ data: null, error: { message } });

let mfa: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(() => ok({ currentLevel: 'aal1', nextLevel: 'aal1' })),
    listFactors: vi.fn(() => ok({ totp: [], all: [] })),
    challenge: vi.fn(() => ok({ id: 'ch-1' })),
    verify: vi.fn(() => ok({})),
  };
  h.client = { auth: { mfa } };
});

describe('useMfaGate (second sign-in step)', () => {
  it('stays idle without a signed-in user', () => {
    const { result } = renderHook(() => useMfaGate(null));
    expect(result.current.state).toBe('idle');
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });

  it('no factor: lets the user in', async () => {
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('pass'));
  });

  it('unverified factor: lets the user in', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [{ id: 'f', status: 'unverified' }] }));
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('pass'));
  });

  it('verified factor at aal1: prompts, and verifying the code lets the user in', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [{ id: 'v', status: 'verified' }] }));
    mfa.getAuthenticatorAssuranceLevel.mockReturnValueOnce(ok({ currentLevel: 'aal1', nextLevel: 'aal2' }));
    mfa.getAuthenticatorAssuranceLevel.mockReturnValue(ok({ currentLevel: 'aal2', nextLevel: 'aal2' }));
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('challenge'));
    await act(async () => { await result.current.verify('123456'); });
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'v' });
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'v', challengeId: 'ch-1', code: '123456' });
    expect(result.current.state).toBe('pass');
  });

  it('verified factor at aal2: passes without a prompt', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [{ id: 'v', status: 'verified' }] }));
    mfa.getAuthenticatorAssuranceLevel.mockReturnValue(ok({ currentLevel: 'aal2', nextLevel: 'aal2' }));
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('pass'));
    expect(mfa.challenge).not.toHaveBeenCalled();
  });

  it('wrong code keeps the prompt and shows a message', async () => {
    mfa.listFactors.mockReturnValue(ok({ totp: [{ id: 'v', status: 'verified' }] }));
    mfa.verify.mockReturnValue(fail('Invalid TOTP code entered'));
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('challenge'));
    await act(async () => { await result.current.verify('000000'); });
    expect(result.current.state).toBe('challenge');
    expect(result.current.error).not.toBe('');
    expect(result.current.verifying).toBe(false);
  });

  it('a failed check shows an error with retry', async () => {
    mfa.listFactors.mockReturnValueOnce(fail('boom'));
    const { result } = renderHook(() => useMfaGate('u1'));
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('pass'));
  });

  it('ignores a stale check after the user changes', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    mfa.listFactors.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { result, rerender } = renderHook(({ id }) => useMfaGate(id), { initialProps: { id: 'u1' as string | null } });
    rerender({ id: 'u2' });
    await waitFor(() => expect(result.current.state).toBe('pass'));
    await act(async () => { resolveFirst({ data: { totp: [{ id: 'v', status: 'verified' }] }, error: null }); });
    expect(result.current.state).toBe('pass');
  });
});

describe('MfaChallenge screen', () => {
  const gate = (over: Partial<Parameters<typeof MfaChallenge>[0]['gate']> = {}) => ({
    state: 'challenge' as const, error: '', verifying: false, verify: vi.fn(), retry: vi.fn(), ...over,
  });

  it('submits a 6-digit code', async () => {
    const g = gate();
    render(<MfaChallenge gate={g} onSignOut={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Verify' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Verification code'), '12a3456');
    await userEvent.click(btn);
    expect(g.verify).toHaveBeenCalledWith('123456');
  });

  it('shows retry and sign out on a check error', async () => {
    const g = gate({ state: 'error', error: 'Network problem' });
    const onSignOut = vi.fn();
    render(<MfaChallenge gate={g} onSignOut={onSignOut} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network problem');
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(g.retry).toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { checkMfaGate, decideMfaGate } from './mfaGate';

const aal1 = { currentLevel: 'aal1' as const, nextLevel: 'aal1' as const };
const aal1Next2 = { currentLevel: 'aal1' as const, nextLevel: 'aal2' as const };
const aal2 = { currentLevel: 'aal2' as const, nextLevel: 'aal2' as const };

describe('decideMfaGate', () => {
  it('no factor: never blocks', () => {
    expect(decideMfaGate(aal1, [])).toEqual({ status: 'pass' });
    expect(decideMfaGate(null, [])).toEqual({ status: 'pass' });
  });

  it('unverified factor only: never blocks', () => {
    expect(decideMfaGate(aal1, [{ id: 'f', status: 'unverified' }])).toEqual({ status: 'pass' });
  });

  it('verified factor at aal1: prompts for the code', () => {
    expect(decideMfaGate(aal1Next2, [{ id: 'u', status: 'unverified' }, { id: 'v', status: 'verified' }])).toEqual({
      status: 'challenge',
      factorId: 'v',
    });
  });

  it('verified factor at aal2: passes', () => {
    expect(decideMfaGate(aal2, [{ id: 'v', status: 'verified' }])).toEqual({ status: 'pass' });
  });
});

describe('checkMfaGate', () => {
  const api = (aal: unknown, factors: unknown, aalError: unknown = null, listError: unknown = null) => ({
    getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve({ data: aal as never, error: aalError })),
    listFactors: vi.fn(() => Promise.resolve({ data: factors as never, error: listError })),
  });

  it('combines the assurance level and the factor list', async () => {
    await expect(checkMfaGate(api(aal1Next2, { totp: [{ id: 'v', status: 'verified' }] }))).resolves.toEqual({
      status: 'challenge',
      factorId: 'v',
    });
    await expect(checkMfaGate(api(aal1, null))).resolves.toEqual({ status: 'pass' });
  });

  it('throws when either call fails', async () => {
    await expect(checkMfaGate(api(null, null, { message: 'aal down' }))).rejects.toEqual({ message: 'aal down' });
    await expect(checkMfaGate(api(aal1, null, null, { message: 'list down' }))).rejects.toEqual({ message: 'list down' });
  });
});

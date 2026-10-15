import { describe, it, expect, beforeEach } from 'vitest';
import { canSendError, resetRateLimiter } from './errorReporter';

describe('Error reporting rate limiter', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('allows up to 10 errors within a 1-minute window', () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(canSendError(now)).toBe(true);
    }
  });

  it('blocks the 11th error within the same window', () => {
    const now = 2_000_000;
    for (let i = 0; i < 10; i++) {
      canSendError(now);
    }
    expect(canSendError(now)).toBe(false);
  });

  it('allows errors again after the window expires', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 10; i++) {
      canSendError(t0);
    }
    // 61 seconds later — outside the 60s window
    const t1 = t0 + 61_000;
    expect(canSendError(t1)).toBe(true);
  });

  it('slides the window — partial expiry frees slots', () => {
    const t0 = 4_000_000;
    // Send 10 at t0
    for (let i = 0; i < 10; i++) {
      canSendError(t0);
    }
    // 30 seconds later, still blocked
    expect(canSendError(t0 + 30_000)).toBe(false);
    // 61 seconds after the first batch, the oldest entries have expired
    expect(canSendError(t0 + 61_000)).toBe(true);
  });

  it('blocks again after refilling the freed slots', () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 10; i++) {
      canSendError(t0);
    }
    const t1 = t0 + 61_000;
    // First 10 in the new window pass
    for (let i = 0; i < 10; i++) {
      expect(canSendError(t1)).toBe(true);
    }
    // 11th is blocked
    expect(canSendError(t1)).toBe(false);
  });
});

import { vi } from 'vitest';
import { reportError, reportCriticalError } from './errorReporter';
import { isUnexpectedError } from './errors';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeClient(opts: { signedIn?: boolean; insertError?: unknown } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  const invoke = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: opts.signedIn === false ? null : { user: { id: 'u1' } } } }) },
    from: vi.fn(() => ({ insert })),
    functions: { invoke },
  };
  return { client: client as unknown as SupabaseClient, insert, invoke };
}

describe('reportError delivery', () => {
  beforeEach(() => resetRateLimiter());

  it('stores the tagged error and asks the server to deliver alerts', async () => {
    const { client, insert, invoke } = fakeClient();
    await reportError(client, { message: 'boom token=abc', route: '/leases', userAgent: 'ua', source: 'save_lease' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', source: 'save_lease', route: '/leases', message: 'boom token= [REDACTED]' }));
    expect(invoke).toHaveBeenCalledWith('error-alert', { body: {} });
  });

  it('does not trigger delivery when the insert fails, and skips signed-out users', async () => {
    const failed = fakeClient({ insertError: { message: 'x' } });
    await reportError(failed.client, { message: 'm', route: '/', userAgent: 'ua' });
    expect(failed.invoke).not.toHaveBeenCalled();
    const anon = fakeClient({ signedIn: false });
    await reportError(anon.client, { message: 'm' });
    expect(anon.insert).not.toHaveBeenCalled();
  });

  it('reports only unexpected failures from critical flows', async () => {
    const { client, insert } = fakeClient();
    reportCriticalError(client, 'month_end', new Error('Cannot modify posted entries'));
    reportCriticalError(client, 'month_end', { code: '23505', message: 'duplicate key' });
    await new Promise((r) => setTimeout(r, 0));
    expect(insert).not.toHaveBeenCalled();
    reportCriticalError(client, 'month_end', new Error('deadlock detected'));
    await vi.waitFor(() => expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source: 'month_end', message: 'month_end: deadlock detected' })));
  });
});

describe('isUnexpectedError', () => {
  it('separates guard messages from real failures', () => {
    expect(isUnexpectedError(new Error('Lease name is required'))).toBe(false);
    expect(isUnexpectedError({ code: '42501', message: 'denied' })).toBe(false);
    expect(isUnexpectedError(new Error('violates row-level security policy'))).toBe(true);
    expect(isUnexpectedError(new Error('permission denied for table leases'))).toBe(true);
    expect(isUnexpectedError(new Error('connection reset'))).toBe(true);
    expect(isUnexpectedError(null)).toBe(true);
  });
});

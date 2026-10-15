import { describe, it, expect, vi } from 'vitest';
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIp,
  formatRetryAfter,
  rateLimitKey,
  tooManyRequests,
} from '../../../supabase/functions/_shared/rateLimit';

function rpcReturning(data: unknown, error: { message: string } | null = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe('edge rate limit policy', () => {
  it('matches the launch limits per function', () => {
    for (const fn of ['recreate-user', 'remove-user', 'admin-update-user-password', 'platform-admin-edit-user', 'platform-admin-delete-user'] as const) {
      expect(RATE_LIMITS[fn]).toEqual({ limit: 10, windowSeconds: 600 });
    }
    expect(RATE_LIMITS['export-backup']).toEqual({ limit: 5, windowSeconds: 3600 });
    expect(RATE_LIMITS['stripe-checkout']).toEqual({ limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMITS['reopen-month-end']).toEqual({ limit: 10, windowSeconds: 3600 });
    expect(Object.keys(RATE_LIMITS)).not.toContain('stripe-webhook');
  });

  it('keys by user when signed in and by IP otherwise', () => {
    expect(rateLimitKey('remove-user', { userId: 'u1', ip: '1.2.3.4' })).toBe('remove-user:user:u1');
    expect(rateLimitKey('remove-user', { ip: '1.2.3.4' })).toBe('remove-user:ip:1.2.3.4');
    expect(rateLimitKey('health', {})).toBe('health:ip:unknown');
  });

  it('reads the first forwarded IP, then proxy headers', () => {
    expect(clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }))).toBe('9.9.9.9');
    expect(clientIp(new Request('https://x', { headers: { 'cf-connecting-ip': '8.8.8.8' } }))).toBe('8.8.8.8');
    expect(clientIp(new Request('https://x', { headers: { 'x-real-ip': '7.7.7.7' } }))).toBe('7.7.7.7');
    expect(clientIp(new Request('https://x'))).toBe('unknown');
  });

  it('formats the wait time in words', () => {
    expect(formatRetryAfter(1)).toBe('1 second');
    expect(formatRetryAfter(45)).toBe('45 seconds');
    expect(formatRetryAfter(60)).toBe('1 minute');
    expect(formatRetryAfter(257)).toBe('5 minutes');
  });
});

describe('checkRateLimit', () => {
  it('passes the rule for the function to the database counter', async () => {
    const admin = rpcReturning([{ allowed: true, current_count: 1, retry_after: 600 }]);
    const res = await checkRateLimit(admin, 'export-backup', { userId: 'u1' });
    expect(admin.rpc).toHaveBeenCalledWith('rate_limit_hit', { p_key: 'export-backup:user:u1', p_limit: 5, p_window_seconds: 3600 });
    expect(res).toEqual({ allowed: true, retryAfter: 600 });
  });

  it('blocks when the counter is over the limit', async () => {
    const res = await checkRateLimit(rpcReturning([{ allowed: false, retry_after: 42 }]), 'remove-user', { userId: 'u1' });
    expect(res).toEqual({ allowed: false, retryAfter: 42 });
  });

  it('accepts a single-object result', async () => {
    const res = await checkRateLimit(rpcReturning({ allowed: false, retry_after: 5 }), 'health', { ip: '1.1.1.1' });
    expect(res.allowed).toBe(false);
  });

  it('falls back to the window length when retry_after is missing', async () => {
    const res = await checkRateLimit(rpcReturning([{ allowed: false }]), 'stripe-checkout', { userId: 'u' });
    expect(res.retryAfter).toBe(3600);
  });

  it('fails open when the counter errors, returns nothing or throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await checkRateLimit(rpcReturning(null, { message: 'down' }), 'remove-user', { userId: 'u' })).allowed).toBe(true);
    expect((await checkRateLimit(rpcReturning([]), 'remove-user', { userId: 'u' })).allowed).toBe(true);
    const throwing = { rpc: vi.fn().mockRejectedValue(new Error('boom')) };
    expect((await checkRateLimit(throwing, 'remove-user', { userId: 'u' })).allowed).toBe(true);
    spy.mockRestore();
  });
});

describe('tooManyRequests', () => {
  it('returns 429 with Retry-After, CORS headers and a clear message', async () => {
    const res = tooManyRequests({ 'Access-Control-Allow-Origin': 'https://app' }, 299.6);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app');
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Please wait 5 minutes and try again.', code: 'RATE_LIMITED', retryAfter: 300 });
  });

  it('never advertises less than one second', () => {
    expect(tooManyRequests({}, 0).headers.get('Retry-After')).toBe('1');
  });
});

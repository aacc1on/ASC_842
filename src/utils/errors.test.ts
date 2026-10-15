import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toUserMessage, getErrorCode, isDuplicateNameError, isUnexpectedError, DUPLICATE_NAME_MESSAGE,
  NETWORK_MESSAGE, RATE_LIMIT_MESSAGE, SESSION_EXPIRED_MESSAGE, UserFacingError,
  CAPTCHA_MESSAGE, isCaptchaError,
} from './errors';
import { edgeFunctionError } from './edgeFunctionError';
import { resetRateLimiter } from './errorReporter';
import { logUnknownError } from './unknownErrorLog';

describe('toUserMessage — Postgres error codes', () => {
  it('maps 23505 to a user-safe duplicate message', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "leases_org_company_name_unique_idx"' };
    expect(toUserMessage(err)).toBe('A record with this name already exists. Use a different name.');
  });

  it('maps 23503 to a user-safe foreign-key message', () => {
    const err = { code: '23503', message: 'insert or update on table "leases" violates foreign key constraint "leases_company_id_fkey"' };
    expect(toUserMessage(err)).toBe('A required related record was not found. Check your selections and try again.');
  });

  it('maps 42501 to a user-safe permission message', () => {
    const err = { code: '42501', message: 'permission denied for table leases' };
    expect(toUserMessage(err)).toBe('You do not have permission to perform this action, or your plan does not include it.');
  });

  it('falls back to generic for unknown codes with internal messages', () => {
    const err = { code: '42P01', message: 'relation "leases" does not exist' };
    expect(toUserMessage(err)).toBe('Something went wrong. Please try again or contact support if it continues.');
  });

  it('uses the provided fallback when available', () => {
    const err = { code: '23505', message: 'duplicate key' };
    expect(toUserMessage(err, 'Custom fallback')).toBe('A record with this name already exists. Use a different name.');
  });
});

describe('isDuplicateNameError', () => {
  it('returns true for 23505', () => {
    expect(isDuplicateNameError({ code: '23505', message: 'duplicate key' })).toBe(true);
  });

  it('returns false for other codes', () => {
    expect(isDuplicateNameError({ code: '23503', message: 'foreign key' })).toBe(false);
  });

  it('returns false for errors without a code', () => {
    expect(isDuplicateNameError(new Error('something'))).toBe(false);
  });
});

describe('getErrorCode', () => {
  it('extracts the code property', () => {
    expect(getErrorCode({ code: '23505', message: 'test' })).toBe('23505');
  });

  it('returns undefined when no code property', () => {
    expect(getErrorCode(new Error('test'))).toBeUndefined();
  });
});

describe('DUPLICATE_NAME_MESSAGE', () => {
  it('contains guidance about using a different name', () => {
    expect(DUPLICATE_NAME_MESSAGE).toContain('different name');
  });
});

const h = vi.hoisted(() => ({ insert: vi.fn((_table: string, _row: unknown) => Promise.resolve({ error: null })) }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => ({ insert: (row: unknown) => h.insert(table, row) }),
    functions: { invoke: () => Promise.resolve({}) },
  },
}));

describe('toUserMessage — single error mapper (E2 bug 3)', () => {
  beforeEach(() => {
    h.insert.mockClear();
    resetRateLimiter();
  });

  it.each([
    ['23514 check violation', { code: '23514', message: 'new row for relation "leases" violates check constraint "x"' }, 'One of the values is outside the allowed range. Check the amounts and dates and try again.'],
    ['23502 not-null violation', { code: '23502', message: 'null value in column "lease_name"' }, 'A required field is missing. Fill in all required fields and try again.'],
    ['P0001 trigger message', { code: 'P0001', message: 'Lease start date falls in a locked month' }, 'Lease start date falls in a locked month'],
    ['PGRST301 expired JWT', { code: 'PGRST301', message: 'JWT expired' }, SESSION_EXPIRED_MESSAGE],
    ['429 status', { status: 429, message: 'rate limited' }, RATE_LIMIT_MESSAGE],
    ['401 status', { status: 401, message: 'unauthorized' }, SESSION_EXPIRED_MESSAGE],
    ['403 edge context status', { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 403 } }, 'You do not have permission to perform this action, or your plan does not include it.'],
    ['fetch TypeError', new TypeError('Failed to fetch'), NETWORK_MESSAGE],
    ['Safari network', new TypeError('Load failed'), NETWORK_MESSAGE],
    ['edge fetch error', { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }, NETWORK_MESSAGE],
    ['user-facing error', new UserFacingError('Only admins can do that today'), 'Only admins can do that today'],
  ])('%s', (_label, err, expected) => {
    expect(toUserMessage(err, 'fallback')).toBe(expected);
  });

  it('P0001 with internal detail still falls back', () => {
    expect(toUserMessage({ code: 'P0001', message: 'relation "x" does not exist' }, 'fallback')).toBe('fallback');
  });

  it('known messages are not logged; unknown errors use the generic text and are logged', () => {
    vi.mocked(logUnknownError).mockClear();
    toUserMessage({ code: '23505', message: 'dup' });
    toUserMessage(new TypeError('Failed to fetch'));
    expect(logUnknownError).not.toHaveBeenCalled();
    const err = new Error('weird internal thing');
    expect(toUserMessage(err)).toBe('Something went wrong. Please try again or contact support if it continues.');
    expect(logUnknownError).toHaveBeenCalledWith(err, 'weird internal thing');
  });

  it('logUnknownError writes the unmapped error to error_logs', async () => {
    const actual = await vi.importActual<typeof import('./unknownErrorLog')>('./unknownErrorLog');
    actual.logUnknownError(new Error('weird'), 'weird');
    await vi.waitFor(() => expect(h.insert).toHaveBeenCalledTimes(1));
    expect(h.insert).toHaveBeenCalledWith('error_logs', expect.objectContaining({ user_id: 'u1', message: 'unmapped: weird' }));
    actual.logUnknownError(null, '');
    await vi.waitFor(() => expect(h.insert).toHaveBeenCalledTimes(2));
    expect(h.insert).toHaveBeenLastCalledWith('error_logs', expect.objectContaining({ message: 'unmapped: empty error' }));
  });

  it('isUnexpectedError agrees with the mapper', () => {
    expect(isUnexpectedError(new UserFacingError('x'))).toBe(false);
    expect(isUnexpectedError({ status: 429, message: 'x' })).toBe(false);
    expect(isUnexpectedError({ code: 'P0001', message: 'Period is locked' })).toBe(false);
    expect(isUnexpectedError(new Error('weird'))).toBe(true);
  });
});

describe('edgeFunctionError', () => {
  const res = (status: number) => ({ status, headers: { get: () => null } });
  it('prefers code messages, then 429/401, then server text; hides 5xx text', () => {
    expect(edgeFunctionError(res(400), { code: 'X', error: 'raw' }, 'fb', { X: 'mapped' }).message).toBe('mapped');
    expect(edgeFunctionError(res(429), {}, 'fb').message).toMatch(/^Too many requests/);
    expect(edgeFunctionError(res(401), {}, 'fb').message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(edgeFunctionError(res(400), { error: 'Role not allowed' }, 'fb').message).toBe('Role not allowed');
    expect(edgeFunctionError(res(400), null, 'fb').message).toBe('fb');
    expect(edgeFunctionError(res(500), { error: 'stack trace' }, 'fb', {}, 'server').message).toBe('server');
    const err = edgeFunctionError(res(409), {}, 'fb');
    expect(err).toBeInstanceOf(UserFacingError);
    expect(toUserMessage(err)).toBe('fb');
  });
});

describe('toUserMessage — captcha errors', () => {
  it.each([
    [{ message: 'captcha verification process failed' }],
    [{ message: 'Captcha protection: request disallowed (timeout-or-duplicate)' }],
    [{ code: 'captcha_failed', message: 'whatever' }],
  ])('maps %o to the security-check message', (err) => {
    expect(isCaptchaError(err)).toBe(true);
    expect(toUserMessage(err)).toBe(CAPTCHA_MESSAGE);
    expect(isUnexpectedError(err)).toBe(false);
  });

  it('does not treat other errors as captcha errors', () => {
    expect(isCaptchaError({ message: 'Invalid login credentials' })).toBe(false);
  });
});

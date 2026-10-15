import { describe, it, expect } from 'vitest';
import { rateLimitMessage } from './edgeFunctionError';

const headers = (retry: string | null) => ({ get: (n: string) => (n === 'Retry-After' ? retry : null) });

describe('rateLimitMessage', () => {
  it('returns null for responses that are not rate limited', () => {
    expect(rateLimitMessage({ status: 400 }, { error: 'bad' })).toBeNull();
    expect(rateLimitMessage({ status: 200 }, {})).toBeNull();
  });

  it('uses the server message when present', () => {
    expect(rateLimitMessage({ status: 429 }, { error: 'Too many requests. Please wait 5 minutes and try again.' }))
      .toBe('Too many requests. Please wait 5 minutes and try again.');
  });

  it('builds a message from retryAfter or the Retry-After header', () => {
    expect(rateLimitMessage({ status: 429 }, { retryAfter: 30 })).toBe('Too many requests. Please wait 30 seconds and try again.');
    expect(rateLimitMessage({ status: 429, headers: headers('600') }, null)).toBe('Too many requests. Please wait 10 minutes and try again.');
    expect(rateLimitMessage({ status: 429, headers: headers('1') }, 'x')).toBe('Too many requests. Please wait 1 second and try again.');
    expect(rateLimitMessage({ status: 429, headers: headers('60') }, {})).toBe('Too many requests. Please wait 1 minute and try again.');
  });

  it('falls back to a general wait when no timing is known', () => {
    expect(rateLimitMessage({ status: 429 }, { error: '  ' })).toBe('Too many requests. Please wait a few minutes and try again.');
  });
});

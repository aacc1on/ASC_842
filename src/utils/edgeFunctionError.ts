import { RATE_LIMIT_MESSAGE, SESSION_EXPIRED_MESSAGE, UserFacingError } from './errors';

function waitText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a few minutes';
  if (seconds < 60) return `${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** User-facing message for a rate-limited (429) edge function response, or null for any other status. */
export function rateLimitMessage(
  res: { status: number; headers?: { get(name: string): string | null } },
  data: unknown,
): string | null {
  if (res.status !== 429) return null;
  const body = (data && typeof data === 'object' ? data : {}) as { error?: unknown; retryAfter?: unknown };
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  const seconds = Number(body.retryAfter ?? res.headers?.get('Retry-After'));
  return `Too many requests. Please wait ${waitText(seconds)} and try again.`;
}

/**
 * Builds the user-facing error for a failed edge function response. Function-specific `code`
 * messages win, then 429/401, then the function's own `error` text (written for end users),
 * then the fallback. 5xx responses never show the server text.
 */
export function edgeFunctionError(
  res: { status: number; headers?: { get(name: string): string | null } },
  data: unknown,
  fallback: string,
  codeMessages: Record<string, string> = {},
  serverFailureMessage: string = fallback,
): UserFacingError {
  const body = (data && typeof data === 'object' ? data : {}) as { error?: unknown; code?: unknown };
  const code = typeof body.code === 'string' ? body.code : undefined;
  const serverText = typeof body.error === 'string' && body.error.trim() ? body.error : undefined;
  let message: string;
  if (code && codeMessages[code]) message = codeMessages[code];
  else if (res.status === 429) message = rateLimitMessage(res, data) ?? RATE_LIMIT_MESSAGE;
  else if (res.status === 401 || code === 'AUTH_EXPIRED') message = SESSION_EXPIRED_MESSAGE;
  else if (res.status >= 500) message = serverFailureMessage;
  else message = serverText ?? fallback;
  return new UserFacingError(message, res.status);
}

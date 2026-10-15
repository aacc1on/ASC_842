/**
 * Rate-limited error reporting to the error_logs table.
 *
 * - Max 10 errors per minute per browser session (sliding window).
 * - Never blocks the UI — all inserts are fire-and-forget.
 * - Strips passwords, tokens, and API keys from messages and stacks
 *   before sending.
 * - Silently no-ops if there is no Supabase session.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRawErrorMessage, isUnexpectedError } from './errors';

const MAX_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

const timestamps: number[] = [];

const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /authorization\s*[:=]\s*bearer\s+\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /"password"\s*:\s*"[^"]*"/gi,
  /"token"\s*:\s*"[^"]*"/gi,
  /"secret"\s*:\s*"[^"]*"/gi,
  /"key"\s*:\s*"[^"]*"/gi,
  /bearer\s+[A-Za-z0-9._-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
];

function sanitize(text: string): string {
  if (!text) return text;
  let cleaned = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, (m) => {
      if (m.startsWith('{')) return m;
      if (/^bearer\s+/i.test(m)) return 'bearer [REDACTED]';
      if (/^eyJ/.test(m)) return '[REDACTED_JWT]';
      if (/@/.test(m) && /\./.test(m)) return '[REDACTED_EMAIL]';
      return m.split(/[:=]/)[0] + '= [REDACTED]';
    });
  }
  cleaned = cleaned.replace(/[?&][^?\s]*password[^?\s]*/gi, '[REDACTED_QUERY]');
  return cleaned.slice(0, 8000);
}

export function resetRateLimiter(): void {
  timestamps.length = 0;
}

export function canSendError(now: number = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_PER_MINUTE) {
    return false;
  }
  timestamps.push(now);
  return true;
}

export interface ErrorPayload {
  message: string;
  stack?: string;
  route?: string;
  userAgent?: string;
  source?: ErrorSource;
}

export type ErrorSource = 'save_lease' | 'month_end';

export async function reportError(
  supabaseClient: SupabaseClient,
  payload: ErrorPayload,
): Promise<void> {
  if (!canSendError()) return;

  try {
    const { data } = await supabaseClient.auth.getSession();
    const session = data.session;
    if (!session?.user?.id) return;

    const route = payload.route ?? window.location.pathname;
    const userAgent = payload.userAgent ?? navigator.userAgent;

    const { error } = await supabaseClient.from('error_logs').insert({
      user_id: session.user.id,
      message: sanitize(payload.message).slice(0, 2000),
      stack: payload.stack ? sanitize(payload.stack) : null,
      route: route || null,
      user_agent: userAgent || null,
      source: payload.source ?? null,
    });
    // The error_logs trigger may have raised an alert; ask the server to deliver it.
    if (!error) void supabaseClient.functions?.invoke('error-alert', { body: {} }).catch(() => undefined);
  } catch {
    // Silent — never block the UI on error reporting
  }
}

/** Reports failures from critical flows, skipping intentional guard and validation messages. */
export function reportCriticalError(
  supabaseClient: SupabaseClient,
  source: ErrorSource,
  error: unknown,
): void {
  if (!isUnexpectedError(error)) return;
  const stack = error instanceof Error ? error.stack : undefined;
  void reportError(supabaseClient, { message: `${source}: ${getRawErrorMessage(error)}`, stack, source });
}

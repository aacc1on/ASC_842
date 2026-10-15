import { supabase } from '../lib/supabase';
import { SESSION_EXPIRED_MESSAGE, toUserMessage, UserFacingError } from './errors';
import { edgeFunctionError } from './edgeFunctionError';

export interface ErrorAlert {
  id: number;
  createdAt: string;
  reason: 'threshold' | 'critical';
  errorCount: number;
  message: string | null;
  source: string | null;
  route: string | null;
  suppressedCount: number;
  deliveryStatus: string;
  deliveredAt: string | null;
  deliveryError: string | null;
}

export interface ErrorAlertSettings {
  threshold: number;
  windowMinutes: number;
  debounceMinutes: number;
}

export const DELIVERY_LABELS: Record<string, string> = {
  pending: 'Waiting to send',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Delivery failed',
  not_configured: 'No alert destination set',
  throttled: 'Not emailed (sent recently)',
};

export const TEST_ALERT_MESSAGES: Record<string, string> = {
  sent: 'Test alert sent. Check the alerts inbox.',
  throttled: 'A test alert was sent less than a minute ago. Please wait and try again.',
  not_configured: 'Email alerts are not set up yet: the Resend API key is missing.',
  failed: 'The test alert could not be delivered. Check the Resend API key and sender domain.',
};

export const SOURCE_LABELS: Record<string, string> = {
  save_lease: 'Saving a lease',
  month_end: 'Month-end',
  stripe_webhook: 'Stripe payments',
};

type Row = Record<string, unknown>;

export function toErrorAlert(r: Row): ErrorAlert {
  return {
    id: Number(r.id),
    createdAt: String(r.created_at ?? ''),
    reason: r.reason === 'critical' ? 'critical' : 'threshold',
    errorCount: Number(r.error_count ?? 0),
    message: typeof r.sample_message === 'string' ? r.sample_message : null,
    source: typeof r.sample_source === 'string' ? r.sample_source : null,
    route: typeof r.sample_route === 'string' ? r.sample_route : null,
    suppressedCount: Number(r.suppressed_count ?? 0),
    deliveryStatus: String(r.delivery_status ?? 'pending'),
    deliveredAt: typeof r.delivered_at === 'string' ? r.delivered_at : null,
    deliveryError: typeof r.delivery_error === 'string' ? r.delivery_error : null,
  };
}

export async function fetchErrorAlerts(limit = 50): Promise<ErrorAlert[]> {
  const { data, error } = await supabase.rpc('get_error_alerts', { p_limit: limit });
  if (error) throw new UserFacingError(toUserMessage(error, 'Could not load error alerts.'));
  return Array.isArray(data) ? (data as Row[]).map(toErrorAlert) : [];
}

export async function fetchErrorAlertSettings(): Promise<ErrorAlertSettings | null> {
  const { data, error } = await supabase.rpc('get_error_alert_settings');
  if (error) throw new UserFacingError(toUserMessage(error, 'Could not load alert settings.'));
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) return null;
  return {
    threshold: Number(row.threshold),
    windowMinutes: Number(row.window_minutes),
    debounceMinutes: Number(row.debounce_minutes),
  };
}

export function validateThreshold(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= 1 && n <= 10000 ? n : null;
}

export async function sendTestAlert(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new UserFacingError(SESSION_EXPIRED_MESSAGE, 401);
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/error-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'test' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw edgeFunctionError(res, data, 'Could not send the test alert.');
  const status = data && typeof data === 'object' ? (data as Row).status : undefined;
  if (typeof status !== 'string' || !TEST_ALERT_MESSAGES[status]) {
    throw new UserFacingError('Could not send the test alert.', res.status);
  }
  if (status === 'failed') throw new UserFacingError(TEST_ALERT_MESSAGES.failed, 502);
  return TEST_ALERT_MESSAGES[status];
}

export async function saveErrorAlertThreshold(threshold: number): Promise<void> {
  const { error } = await supabase.rpc('set_error_alert_threshold', { p_threshold: threshold });
  if (error) throw new UserFacingError(toUserMessage(error, 'Could not save the alert threshold.'));
}

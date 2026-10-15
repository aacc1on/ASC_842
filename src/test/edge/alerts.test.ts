import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  ALERT_FROM,
  DEFAULT_ALERT_EMAIL_TO,
  RESEND_URL,
  alertTypeKey,
  buildAlertEmail,
  buildAlertPayload,
  deliverPendingAlerts,
  isValidWebhookUrl,
  logServerError,
  maskOrgId,
  readAlertConfig,
  sanitizeAlertText,
  sendTestAlert,
  type AlertConfig,
  type PendingAlert,
} from '../../../supabase/functions/_shared/alerts';

const ORG = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';

const alert = (over: Partial<PendingAlert> = {}): PendingAlert => ({
  id: 7,
  created_at: '2026-10-13T05:00:00Z',
  reason: 'critical',
  error_count: 3,
  sample_message: 'save_lease: deadlock detected',
  sample_source: 'save_lease',
  sample_route: '/leases',
  sample_org_id: ORG,
  suppressed_count: 2,
  ...over,
});

const cfg = (over: Partial<AlertConfig> = {}): AlertConfig => ({
  resendApiKey: 're_test_key_123',
  emailTo: DEFAULT_ALERT_EMAIL_TO,
  webhookUrl: null,
  appUrl: 'https://app.example.com',
  ...over,
});

function makeAdmin(pending: PendingAlert[] | null, opts: { claimError?: { message: string }; slots?: boolean[] } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const slots = [...(opts.slots ?? [])];
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'claim_pending_error_alerts') return { data: pending, error: opts.claimError ?? null };
    if (fn === 'claim_alert_email_slot') return { data: slots.length ? slots.shift() : true, error: null };
    return { data: null, error: null };
  });
  return { rpc, from: vi.fn(() => ({ insert })), insert };
}

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('alert email content', () => {
  it('includes type, severity, UTC time, where, message, masked org, occurrences and the admin link', () => {
    const e = buildAlertEmail(alert(), 'https://app.example.com/');
    expect(e.text).toContain('Alert type: Critical error');
    expect(e.text).toContain('Severity: Critical');
    expect(e.text).toContain('Time (UTC): 2026-10-13 05:00 UTC');
    expect(e.text).toContain('Function / screen: Saving a lease');
    expect(e.text).toContain('Message: save_lease: deadlock detected');
    expect(e.text).toContain('Organization: 3f2a****5e6f');
    expect(e.text).toContain('Occurrences: 5');
    expect(e.text).toContain('https://app.example.com/admin#error-alerts');
    expect(e.text).not.toContain(ORG);
  });

  it('never includes customer data, emails, tokens, passwords, keys or stack traces', () => {
    const nasty = [
      'insert failed for jane.doe@acme.com: duplicate key value violates "leases_name_key"',
      'Key (name)=(Acme HQ Lease 5th Ave) already exists password=hunter2 token: abc123',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlc2lnbmF0dXJl sk_live_51Habcdefghijkl',
      `lease ${ORG} 'Main Street Warehouse' secret=s3cr3t`,
      '    at saveLease (https://x/assets/index.js:1:2)\n    at SUPABASE_SERVICE_ROLE_KEY=abc',
    ].join(' ');
    const e = buildAlertEmail(alert({ sample_message: `${nasty}\nError: stack\n  at fn (file.ts:10)` }), 'https://a.example.com');
    const hook = JSON.stringify(buildAlertPayload(alert({ sample_message: nasty })));
    for (const out of [e.text, e.html, e.subject, hook]) {
      for (const secret of ['jane.doe@acme.com', 'Acme HQ Lease', 'hunter2', 'abc123', 'eyJhbGciOiJIUzI1NiJ9', 'sk_live_51H', ORG, 'Main Street Warehouse', 's3cr3t', 'file.ts:10', 'leases_name_key']) {
        expect(out).not.toContain(secret);
      }
    }
    expect(sanitizeAlertText('x'.repeat(500)).length).toBeLessThanOrEqual(160);
  });

  it('escapes HTML in the email body', () => {
    const e = buildAlertEmail(alert({ sample_message: '<script>alert(1)</script>' }), 'https://a.example.com');
    expect(e.html).not.toContain('<script>');
  });

  it('masks organization ids and handles missing ones', () => {
    expect(maskOrgId(ORG)).toBe('3f2a****5e6f');
    expect(maskOrgId(null)).toBe('not recorded');
  });

  it('keys the throttle by alert reason and source', () => {
    expect(alertTypeKey(alert())).toBe('critical:save_lease');
    expect(alertTypeKey(alert({ reason: 'threshold', sample_source: null }))).toBe('threshold:general');
    expect(alertTypeKey(alert({ reason: 'test' }))).toBe('test');
  });

  it('only accepts https webhook destinations', () => {
    expect(isValidWebhookUrl('https://hooks.example.com/x')).toBe(true);
    expect(isValidWebhookUrl('http://hooks.example.com/x')).toBe(false);
    expect(isValidWebhookUrl('not a url')).toBe(false);
    expect(isValidWebhookUrl(undefined)).toBe(false);
  });
});

describe('readAlertConfig', () => {
  const stubEnv = (env: Record<string, string>) =>
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });

  it('defaults the recipient and treats the webhook as optional', () => {
    stubEnv({});
    expect(readAlertConfig()).toMatchObject({ resendApiKey: null, emailTo: DEFAULT_ALERT_EMAIL_TO, webhookUrl: null });
  });

  it('uses ALERT_EMAIL_TO only when it is a valid address', () => {
    stubEnv({ ALERT_EMAIL_TO: 'ops@ms-consult.us', RESEND_API_KEY: ' re_x ' });
    expect(readAlertConfig()).toMatchObject({ emailTo: 'ops@ms-consult.us', resendApiKey: 're_x' });
    stubEnv({ ALERT_EMAIL_TO: 'not-an-email' });
    expect(readAlertConfig().emailTo).toBe(DEFAULT_ALERT_EMAIL_TO);
  });
});

describe('deliverPendingAlerts', () => {
  it('emails each claimed alert through Resend and marks it sent', async () => {
    const admin = makeAdmin([alert()]);
    const fetchImpl = okFetch();
    const res = await deliverPendingAlerts(admin, cfg(), fetchImpl);
    expect(res).toEqual({ claimed: 1, sent: 1, failed: 0, notConfigured: 0, throttled: 0 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(RESEND_URL);
    expect(init.headers.Authorization).toBe('Bearer re_test_key_123');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: ALERT_FROM, to: ['minas@ms-consult.us'] });
    expect(admin.rpc).toHaveBeenCalledWith('claim_alert_email_slot', { p_alert_type: 'critical:save_lease', p_window_minutes: 15 });
    expect(admin.rpc).toHaveBeenCalledWith('mark_error_alert', { p_id: 7, p_status: 'sent' });
  });

  it('throttles to one email per error type per window', async () => {
    const admin = makeAdmin([alert({ id: 1 }), alert({ id: 2 })], { slots: [true, false] });
    const fetchImpl = okFetch();
    const res = await deliverPendingAlerts(admin, cfg(), fetchImpl);
    expect(res).toMatchObject({ sent: 1, throttled: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith('mark_error_alert', { p_id: 2, p_status: 'throttled' });
  });

  it('skips email silently when RESEND_API_KEY is missing and keeps the in-app record', async () => {
    const admin = makeAdmin([alert()]);
    const fetchImpl = vi.fn();
    const res = await deliverPendingAlerts(admin, cfg({ resendApiKey: null }), fetchImpl);
    expect(res.notConfigured).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalledWith('claim_alert_email_slot', expect.anything());
    expect(admin.rpc).toHaveBeenCalledWith('mark_error_alert', expect.objectContaining({ p_status: 'not_configured' }));
  });

  it('also posts to ALERT_WEBHOOK_URL when set, and works with only a webhook', async () => {
    const both = okFetch();
    await deliverPendingAlerts(makeAdmin([alert()]), cfg({ webhookUrl: 'https://hooks.example.com/x' }), both);
    expect(both.mock.calls.map((c) => c[0])).toEqual([RESEND_URL, 'https://hooks.example.com/x']);

    const hookOnly = okFetch();
    const res = await deliverPendingAlerts(makeAdmin([alert()]), cfg({ resendApiKey: null, webhookUrl: 'https://hooks.example.com/x' }), hookOnly);
    expect(res.sent).toBe(1);
    expect(hookOnly.mock.calls.map((c) => c[0])).toEqual(['https://hooks.example.com/x']);
  });

  it('marks failed on a non-2xx response or a network error', async () => {
    const admin = makeAdmin([alert({ id: 1 }), alert({ id: 2, sample_source: 'month_end' })]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('offline'));
    const res = await deliverPendingAlerts(admin, cfg(), fetchImpl);
    expect(res).toMatchObject({ claimed: 2, sent: 0, failed: 2 });
    expect(admin.rpc).toHaveBeenCalledWith('mark_error_alert', { p_id: 1, p_status: 'failed', p_error: 'Email responded 500' });
    expect(admin.rpc).toHaveBeenCalledWith('mark_error_alert', { p_id: 2, p_status: 'failed', p_error: 'Email: offline' });
  });

  it('does nothing when no alerts are pending (debounced)', async () => {
    const admin = makeAdmin([]);
    const res = await deliverPendingAlerts(admin, cfg(), vi.fn());
    expect(res.claimed).toBe(0);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it('throws when alerts cannot be claimed', async () => {
    await expect(deliverPendingAlerts(makeAdmin(null, { claimError: { message: 'nope' } }), cfg())).rejects.toThrow('claim failed: nope');
  });
});

describe('sendTestAlert', () => {
  it('sends one test email through the same throttled path', async () => {
    const admin = makeAdmin([]);
    const fetchImpl = okFetch();
    expect(await sendTestAlert(admin, cfg(), fetchImpl)).toEqual({ status: 'sent', error: null });
    expect(admin.rpc).toHaveBeenCalledWith('claim_alert_email_slot', { p_alert_type: 'test', p_window_minutes: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).subject).toContain('Test alert');
  });

  it('reports not_configured without the key and throttled when sent recently', async () => {
    expect((await sendTestAlert(makeAdmin([]), cfg({ resendApiKey: null }), vi.fn())).status).toBe('not_configured');
    expect((await sendTestAlert(makeAdmin([], { slots: [false] }), cfg(), vi.fn())).status).toBe('throttled');
  });
});

describe('logServerError', () => {
  it('records the error with its source and delivers alerts', async () => {
    const admin = makeAdmin([]);
    await logServerError(admin, 'stripe_webhook', 'stripe-webhook: boom', cfg({ resendApiKey: null }));
    expect(admin.insert).toHaveBeenCalledWith({ message: 'stripe-webhook: boom', source: 'stripe_webhook', route: 'stripe_webhook' });
    expect(admin.rpc).toHaveBeenCalledWith('claim_pending_error_alerts');
  });

  it('never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = makeAdmin(null, { claimError: { message: 'down' } });
    await expect(logServerError(admin, 'stripe_webhook', 'x', cfg())).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

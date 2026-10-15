import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const getSession = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => getSession() } },
}));

import {
  fetchErrorAlertSettings,
  fetchErrorAlerts,
  saveErrorAlertThreshold,
  sendTestAlert,
  toErrorAlert,
  validateThreshold,
} from './errorAlerts';

beforeEach(() => rpc.mockReset());

describe('error alerts data', () => {
  it('maps database rows to alerts', () => {
    expect(toErrorAlert({
      id: '3', created_at: '2026-10-13T05:00:00Z', reason: 'critical', error_count: 2, sample_message: 'm',
      sample_source: 'month_end', sample_route: '/month-end', suppressed_count: 4, delivery_status: 'sent',
      delivered_at: '2026-10-13T05:01:00Z', delivery_error: null,
    })).toEqual({
      id: 3, createdAt: '2026-10-13T05:00:00Z', reason: 'critical', errorCount: 2, message: 'm', source: 'month_end',
      route: '/month-end', suppressedCount: 4, deliveryStatus: 'sent', deliveredAt: '2026-10-13T05:01:00Z', deliveryError: null,
    });
  });

  it('defaults unknown or missing fields safely', () => {
    const a = toErrorAlert({ id: 1, reason: 'weird' });
    expect(a).toMatchObject({ reason: 'threshold', errorCount: 0, suppressedCount: 0, deliveryStatus: 'pending', message: null, createdAt: '' });
  });

  it('loads the alert list for platform admins', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1, reason: 'threshold', error_count: 11 }], error: null });
    const list = await fetchErrorAlerts(25);
    expect(rpc).toHaveBeenCalledWith('get_error_alerts', { p_limit: 25 });
    expect(list[0].errorCount).toBe(11);
  });

  it('returns an empty list for a malformed response and throws a safe message on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchErrorAlerts()).toEqual([]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authorized', code: '42501' } });
    await expect(fetchErrorAlerts()).rejects.toThrow(/permission/i);
  });

  it('loads settings and handles a missing row', async () => {
    rpc.mockResolvedValueOnce({ data: [{ threshold: 10, window_minutes: 15, debounce_minutes: 30 }], error: null });
    expect(await fetchErrorAlertSettings()).toEqual({ threshold: 10, windowMinutes: 15, debounceMinutes: 30 });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await fetchErrorAlertSettings()).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchErrorAlertSettings()).rejects.toThrow('Could not load alert settings.');
  });

  it('validates and saves the threshold', async () => {
    expect(validateThreshold('10')).toBe(10);
    expect(validateThreshold(' 25 ')).toBe(25);
    expect(validateThreshold('0')).toBeNull();
    expect(validateThreshold('10001')).toBeNull();
    expect(validateThreshold('2.5')).toBeNull();
    expect(validateThreshold('abc')).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await saveErrorAlertThreshold(12);
    expect(rpc).toHaveBeenCalledWith('set_error_alert_threshold', { p_threshold: 12 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(saveErrorAlertThreshold(12)).rejects.toThrow('Could not save the alert threshold.');
  });
});

describe('sendTestAlert', () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }));

  beforeEach(() => {
    vi.unstubAllGlobals();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  });

  it('asks the alert function for a test send and explains each outcome', async () => {
    respond(200, { status: 'sent' });
    expect(await sendTestAlert()).toMatch(/Test alert sent/);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/error-alert$/);
    expect(JSON.parse(String(init.body))).toEqual({ action: 'test' });
    respond(200, { status: 'not_configured' });
    expect(await sendTestAlert()).toMatch(/Resend API key is missing/);
    respond(200, { status: 'throttled' });
    expect(await sendTestAlert()).toMatch(/less than a minute ago/);
    respond(200, { status: 'failed' });
    await expect(sendTestAlert()).rejects.toThrow(/could not be delivered/);
  });

  it('surfaces the owner-only refusal', async () => {
    respond(403, { error: 'Only the platform owner can send a test alert.', code: 'NOT_PLATFORM_ADMIN' });
    await expect(sendTestAlert()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

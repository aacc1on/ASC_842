import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFakeSupabase, type FakeSupabaseOptions } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { useBackup } from './useBackup';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));


function resp(status: number, body: unknown, headers: Record<string, string> = {}, jsonFails = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { if (jsonFails) throw new SyntaxError('Unexpected token <'); return body; },
    blob: async () => new Blob(['{"backup":true}'], { type: 'application/json' }),
    headers: new Headers(headers),
  };
}

let tables: Tables;
let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;

function setup(opts: Partial<FakeSupabaseOptions> = {}) {
  const fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = fake as unknown as Record<string, unknown>;
  return fake;
}

beforeEach(() => {
  tables = {
    leases: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }],
    lessors: [{ id: 'x' }],
    audit_log: [{ id: 'a1' }, { id: 'a2' }],
  };
  setup();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  createObjectURL = vi.fn(() => 'blob:mock-url');
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
});

describe('useBackup – loadBackupCounts', () => {
  it('has idle initial state', () => {
    const { result } = renderHook(() => useBackup({ userEmail: 'a@b.c' }));
    expect(result.current).toMatchObject({
      backupLoading: false, backupCounts: null, backupCountsLoading: false, lastBackupAt: null, backupMessage: '',
    });
  });

  it('counts rows per table, zero for empty tables', async () => {
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.loadBackupCounts(); });
    const c = result.current.backupCounts!;
    expect(c.leases).toBe(3);
    expect(c.lessors).toBe(1);
    expect(c.audit_log).toBe(2);
    expect(c.transactions).toBe(0);
    expect(Object.keys(c)).toHaveLength(18);
    expect(result.current.backupCountsLoading).toBe(false);
  });

  it('uses 0 for tables whose count query errors', async () => {
    setup({ failures: { select: { leases: 'permission denied' } } });
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.loadBackupCounts(); });
    expect(result.current.backupCounts?.leases).toBe(0);
    expect(result.current.backupCounts?.audit_log).toBe(2);
  });

  it('uses 0 when count is null', async () => {
    h.client = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: null, error: null }) }) }) };
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.loadBackupCounts(); });
    expect(result.current.backupCounts?.leases).toBe(0);
  });

  it('resets counts to null on a thrown error', async () => {
    h.client = { from: () => { throw new Error('offline'); } };
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.loadBackupCounts(); });
    expect(result.current.backupCounts).toBeNull();
    expect(result.current.backupCountsLoading).toBe(false);
  });
});

describe('useBackup – handleDownloadBackup', () => {
  it('posts to export-backup and downloads the blob', async () => {
    fetchMock.mockResolvedValue(resp(200, null));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const append = vi.spyOn(document.body, 'appendChild');
    const remove = vi.spyOn(document.body, 'removeChild');
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:54321/functions/v1/export-backup');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(init.body).toBe('{}');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const anchor = append.mock.calls.map((c) => c[0]).find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement;
    expect(anchor.download).toBe('backup-1700000000000.json');
    expect(anchor.href).toBe('blob:mock-url');
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(result.current.backupMessage).toBe('Backup downloaded successfully.');
    expect(result.current.lastBackupAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.current.backupLoading).toBe(false);
  });

  it('shows a rate-limit message on 429', async () => {
    fetchMock.mockResolvedValue(resp(429, {}, { 'Retry-After': '90' }));
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });
    expect(result.current.backupMessage).toBe('Too many requests. Please wait 2 minutes and try again.');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(result.current.lastBackupAt).toBeNull();
  });

  it('shows a safe server error message', async () => {
    fetchMock.mockResolvedValue(resp(403, { error: 'Backups are not allowed on your plan' }));
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });
    expect(result.current.backupMessage).toBe('Backups are not allowed on your plan');
  });

  it('falls back (sanitized) when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(resp(502, null, {}, true));
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });
    expect(result.current.backupMessage).toBe('The backup could not be created. Please try again.');
    expect(result.current.backupLoading).toBe(false);
  });

  it('requires a session', async () => {
    setup({ signedOut: true });
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.backupMessage).toBe('Your session has expired. Please sign in again.');
  });

  it('reports network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useBackup());
    await act(async () => { await result.current.handleDownloadBackup(); });
    expect(result.current.backupMessage).toBe('We could not reach the server. Check your internet connection and try again.');
  });
});

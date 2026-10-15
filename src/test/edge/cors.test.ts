import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const corsSource = readFileSync(resolve(__dirname, '../../../supabase/functions/_shared/cors.ts'), 'utf8');

async function loadCors(env: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  vi.resetModules();
  return import('../../../supabase/functions/_shared/cors');
}

describe('CORS allowed origins', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const preview = 'https://abc123.webcontainer-api.io';
  const live = 'https://asc-842-lease-accoun-i2cs.bolt.host';

  it('blocks Bolt preview origins by default (secure by default) but keeps the live site', async () => {
    const cors = await loadCors({});
    expect(cors.isAllowedOrigin(preview)).toBe(false);
    expect(cors.isAllowedOrigin(live)).toBe(true);
  });

  it('allows Bolt preview origins only when ALLOW_BOLT_PREVIEW=true', async () => {
    const cors = await loadCors({ ALLOW_BOLT_PREVIEW: 'true' });
    expect(cors.isAllowedOrigin(preview)).toBe(true);
  });

  it('blocks Bolt preview origins when ALLOW_BOLT_PREVIEW=false, keeping the live site and APP_ORIGINS', async () => {
    const cors = await loadCors({ ALLOW_BOLT_PREVIEW: 'false', APP_ORIGINS: 'https://custom.example.com' });
    expect(cors.isAllowedOrigin(preview)).toBe(false);
    expect(cors.isAllowedOrigin(live)).toBe(true);
    expect(cors.isAllowedOrigin('https://custom.example.com')).toBe(true);
    const res = cors.preflightResponse(new Request('https://fn', { method: 'OPTIONS', headers: { Origin: preview } }));
    expect(res.status).toBe(403);
  });

  it('treats the flag case-insensitively', async () => {
    const cors = await loadCors({ ALLOW_BOLT_PREVIEW: ' FALSE ' });
    expect(cors.isAllowedOrigin(preview)).toBe(false);
  });

  it('never allows unknown or non-https origins', async () => {
    const cors = await loadCors({ ALLOW_BOLT_PREVIEW: 'true' });
    expect(cors.isAllowedOrigin('http://abc.webcontainer-api.io')).toBe(false);
    expect(cors.isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(cors.isAllowedOrigin(null)).toBe(false);
  });

  it('documents the launch switch next to the rule', () => {
    expect(corsSource).toMatch(/LAUNCH: set the ALLOW_BOLT_PREVIEW secret to "false"/);
  });
});

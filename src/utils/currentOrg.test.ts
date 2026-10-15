import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Tables } from '../test/fixtures/goldenPortfolio';
import { SESSION_EXPIRED_MESSAGE } from './errors';

vi.unmock('./currentOrg');

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

let tables: Tables;
let profileReads: number;

function install(opts: Parameters<typeof createFakeSupabase>[1]) {
  const fake = createFakeSupabase(tables, opts);
  h.client = {
    ...fake,
    from: (t: string) => {
      if (t === 'user_profiles') profileReads++;
      return fake.from(t);
    },
  } as unknown as Record<string, unknown>;
  return fake;
}

async function freshModule() {
  vi.resetModules();
  return import('./currentOrg');
}

beforeEach(() => {
  profileReads = 0;
  tables = {
    user_profiles: [
      { user_id: 'u1', organization_id: 'org-1' },
      { user_id: 'u2', organization_id: 'org-2' },
      { user_id: 'u3', organization_id: null },
    ],
  };
});

describe('currentOrgId', () => {
  it("returns the signed-in user's organization and reads the profile only once", async () => {
    install({ userId: 'u1' });
    const { currentOrgId } = await freshModule();
    await expect(currentOrgId()).resolves.toBe('org-1');
    await expect(currentOrgId()).resolves.toBe('org-1');
    expect(profileReads).toBe(1);
  });

  it('looks the organization up again when a different user signs in', async () => {
    install({ userId: 'u1' });
    const { currentOrgId } = await freshModule();
    await expect(currentOrgId()).resolves.toBe('org-1');
    install({ userId: 'u2' });
    await expect(currentOrgId()).resolves.toBe('org-2');
  });

  it('asks the user to sign in again when there is no session', async () => {
    install({ userId: 'u1', signedOut: true });
    const { currentOrgId } = await freshModule();
    await expect(currentOrgId()).rejects.toMatchObject({ message: SESSION_EXPIRED_MESSAGE, status: 401 });
  });

  it('explains when the account has no organization', async () => {
    install({ userId: 'u3' });
    const { currentOrgId } = await freshModule();
    await expect(currentOrgId()).rejects.toThrow(/not linked to an organization/);
  });

  it('does not keep a failed lookup cached', async () => {
    const fake = install({ userId: 'u1' });
    fake.failures.select = { user_profiles: 'boom' };
    const { currentOrgId } = await freshModule();
    await expect(currentOrgId()).rejects.toBeTruthy();
    fake.failures.select = {};
    await expect(currentOrgId()).resolves.toBe('org-1');
  });

  it('lists every org-scoped table once', async () => {
    const { ORG_SCOPED_TABLES } = await freshModule();
    expect(new Set(ORG_SCOPED_TABLES).size).toBe(ORG_SCOPED_TABLES.length);
    expect(ORG_SCOPED_TABLES).toContain('contract_modifications');
  });
});

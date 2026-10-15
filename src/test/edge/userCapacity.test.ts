import { describe, it, expect, vi } from 'vitest';
import { checkUserCapacity, userLimitMessage } from '../../../supabase/functions/_shared/userCapacity';

const ch = { 'Access-Control-Allow-Origin': '*' };

function client(data: unknown, error: unknown = null) {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe('recreate-user capacity check', () => {
  it('allows the 10th user (9 already in the org)', async () => {
    const admin = client({ used: 9, max: 10 });
    expect(await checkUserCapacity(admin, 'org-1', ch)).toBeNull();
    expect(admin.rpc).toHaveBeenCalledWith('org_user_capacity', { p_org: 'org-1' });
  });

  it('rejects the 11th user with the plan limit message', async () => {
    const res = await checkUserCapacity(client({ used: 10, max: 10 }), 'org-1', ch);
    expect(res?.status).toBe(403);
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res?.json()).toEqual({
      error: 'Your plan allows up to 10 users. Remove a user or contact us to add more.',
      code: 'USER_LIMIT',
      used: 10,
      max: 10,
    });
  });

  it('keeps the upgrade message for single-user plans', async () => {
    const res = await checkUserCapacity(client({ used: 1, max: 1 }), 'org-1', ch);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: 'PLAN_RESTRICTED' });
  });

  it('fails closed when the capacity cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await checkUserCapacity(client(null, { message: 'boom' }), 'org-1', ch);
    expect(res?.status).toBe(500);
    expect(await res?.json()).toMatchObject({ code: 'CAPACITY_CHECK_FAILED' });
  });

  it('formats the limit message', () => {
    expect(userLimitMessage(10)).toBe('Your plan allows up to 10 users. Remove a user or contact us to add more.');
  });
});

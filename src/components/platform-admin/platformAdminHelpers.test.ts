import { describe, it, expect } from 'vitest';
import {
  filterPlatformUsers,
  formatDate,
  planBadgeClass,
  resolvePlanLabel,
  roleBadgeClass,
  type PlatformUser,
} from './platformAdminHelpers';

const user = (over: Partial<PlatformUser>): PlatformUser => ({
  user_id: 'u',
  email: 'a@x.com',
  full_name: null,
  role: 'view',
  organization_id: null,
  org_name: null,
  plan_key: null,
  plan_status: null,
  trial_ends_at: null,
  current_period_end: null,
  created_at: '2026-01-01',
  ...over,
});

describe('platformAdminHelpers', () => {
  it('resolves plan labels', () => {
    expect(resolvePlanLabel(null, null)).toBe('No subscription');
    expect(resolvePlanLabel('enterprise', 'trialing')).toBe('Free Trial');
    expect(resolvePlanLabel('professional', 'past_due')).toMatch(/\(past due\)$/);
    expect(resolvePlanLabel(null, 'canceled')).toBe('canceled');
  });

  it('picks badge classes', () => {
    expect(planBadgeClass('enterprise', 'active')).toContain('emerald');
    expect(planBadgeClass(null, 'trialing')).toContain('blue');
    expect(planBadgeClass(null, 'past_due')).toContain('amber');
    expect(roleBadgeClass('admin')).toContain('blue');
    expect(roleBadgeClass('manage')).toContain('cyan');
    expect(roleBadgeClass('view')).toContain('slate');
  });

  it('formats dates and handles null', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('2026-03-15T12:00:00')).toBe('Mar 15, 2026');
  });

  it('filters across email, name, org, role and plan', () => {
    const users = [
      user({ user_id: '1', email: 'alice@acme.com', org_name: 'Acme' }),
      user({ user_id: '2', email: 'bob@beta.com', full_name: 'Bob', role: 'admin', plan_key: 'starter' }),
    ];
    expect(filterPlatformUsers(users, '  ')).toHaveLength(2);
    expect(filterPlatformUsers(users, 'ACME').map((u) => u.user_id)).toEqual(['1']);
    expect(filterPlatformUsers(users, 'admin').map((u) => u.user_id)).toEqual(['2']);
    expect(filterPlatformUsers(users, 'starter').map((u) => u.user_id)).toEqual(['2']);
    expect(filterPlatformUsers(users, 'zzz')).toEqual([]);
  });
});

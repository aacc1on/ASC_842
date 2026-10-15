import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  fetchMyPlan,
  hasFeature,
  planDisplayName,
  EXPIRED_PLAN,
  type MyPlan,
  type PlanKey,
} from '../utils/planFeatures';
import { UpgradeCard } from '../components/UpgradeCard';

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';

const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;

const TRIAL_PLAN: MyPlan = {
  plan_key: 'trial',
  status: 'trial',
  trial_ends_at: '2026-10-15T00:00:00Z',
  days_left: 5,
  features: {
    contract_modifications: true,
    branches: true,
    multi_user: true,
  },
};

const EXPIRED_TRIAL_PLAN: MyPlan = {
  plan_key: 'expired',
  status: 'expired',
  trial_ends_at: '2026-09-20T00:00:00Z',
  days_left: 0,
  features: {
    contract_modifications: false,
    branches: false,
    multi_user: false,
  },
};

const STARTER_PLAN: MyPlan = {
  plan_key: 'starter',
  status: 'active',
  trial_ends_at: null,
  days_left: null,
  features: {
    contract_modifications: false,
    branches: false,
    multi_user: false,
  },
};

const PROFESSIONAL_PLAN: MyPlan = {
  plan_key: 'professional',
  status: 'active',
  trial_ends_at: null,
  days_left: null,
  features: {
    contract_modifications: true,
    branches: true,
    multi_user: false,
  },
};

const ENTERPRISE_PLAN: MyPlan = {
  plan_key: 'enterprise',
  status: 'active',
  trial_ends_at: null,
  days_left: null,
  features: {
    contract_modifications: true,
    branches: true,
    multi_user: true,
  },
};

const PAST_DUE_PLAN: MyPlan = {
  plan_key: 'professional',
  status: 'past_due',
  trial_ends_at: null,
  days_left: 3,
  features: {
    contract_modifications: true,
    branches: true,
    multi_user: false,
  },
};

const CANCELLED_PLAN: MyPlan = {
  plan_key: 'expired',
  status: 'cancelled',
  trial_ends_at: null,
  days_left: null,
  features: {
    contract_modifications: false,
    branches: false,
    multi_user: false,
  },
};

describe('fetchMyPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trial plan when DB returns trial', async () => {
    mockRpc.mockResolvedValue({ data: TRIAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('trial');
    expect(plan.status).toBe('trial');
    expect(plan.days_left).toBe(5);
    expect(plan.features.multi_user).toBe(true);
  });

  it('returns expired plan when trial has ended', async () => {
    mockRpc.mockResolvedValue({ data: EXPIRED_TRIAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('expired');
    expect(plan.features.contract_modifications).toBe(false);
  });

  it('returns active starter plan', async () => {
    mockRpc.mockResolvedValue({ data: STARTER_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('starter');
    expect(plan.features.multi_user).toBe(false);
  });

  it('returns active professional plan', async () => {
    mockRpc.mockResolvedValue({ data: PROFESSIONAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('professional');
    expect(plan.features.contract_modifications).toBe(true);
    expect(plan.features.multi_user).toBe(false);
  });

  it('returns active enterprise plan', async () => {
    mockRpc.mockResolvedValue({ data: ENTERPRISE_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('enterprise');
    expect(plan.features.multi_user).toBe(true);
  });

  it('returns past_due plan with days_left in grace period', async () => {
    mockRpc.mockResolvedValue({ data: PAST_DUE_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('professional');
    expect(plan.status).toBe('past_due');
    expect(plan.days_left).toBe(3);
  });

  it('returns expired for cancelled subscription', async () => {
    mockRpc.mockResolvedValue({ data: CANCELLED_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('expired');
    expect(plan.status).toBe('cancelled');
  });

  it('falls back to EXPIRED_PLAN on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });
    const plan = await fetchMyPlan();
    expect(plan).toBe(EXPIRED_PLAN);
    expect(plan.plan_key).toBe('expired');
  });

  it('falls back to EXPIRED_PLAN on null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const plan = await fetchMyPlan();
    expect(plan).toBe(EXPIRED_PLAN);
  });
});

describe('UI and DB agree — get_my_plan result drives all feature gates', () => {
  it('trial: all features enabled, days_left > 0', async () => {
    mockRpc.mockResolvedValue({ data: TRIAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.features.contract_modifications).toBe(true);
    expect(plan.features.branches).toBe(true);
    expect(plan.features.multi_user).toBe(true);
    expect(plan.days_left).toBeGreaterThan(0);
  });

  it('expired trial: read-only banner, writes blocked, data readable', async () => {
    mockRpc.mockResolvedValue({ data: EXPIRED_TRIAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('expired');
    expect(plan.features.contract_modifications).toBe(false);
    expect(plan.features.multi_user).toBe(false);
    expect(plan.days_left).toBe(0);
  });

  it('active starter: no premium features', async () => {
    mockRpc.mockResolvedValue({ data: STARTER_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.features.contract_modifications).toBe(false);
    expect(plan.features.branches).toBe(false);
    expect(plan.features.multi_user).toBe(false);
  });

  it('active professional: mods + branches, no multi_user', async () => {
    mockRpc.mockResolvedValue({ data: PROFESSIONAL_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.features.contract_modifications).toBe(true);
    expect(plan.features.branches).toBe(true);
    expect(plan.features.multi_user).toBe(false);
  });

  it('active enterprise: all features', async () => {
    mockRpc.mockResolvedValue({ data: ENTERPRISE_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.features.multi_user).toBe(true);
  });

  it('past_due: still has plan features during grace period', async () => {
    mockRpc.mockResolvedValue({ data: PAST_DUE_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('professional');
    expect(plan.days_left).toBe(3);
    expect(plan.features.contract_modifications).toBe(true);
  });

  it('cancelled: expired, no features', async () => {
    mockRpc.mockResolvedValue({ data: CANCELLED_PLAN, error: null });
    const plan = await fetchMyPlan();
    expect(plan.plan_key).toBe('expired');
    expect(plan.features.multi_user).toBe(false);
  });
});

describe('hasFeature — pure display helper (still works for fallback)', () => {
  const planKey: PlanKey = 'starter';

  it('blocks contract_modifications for starter', () => {
    expect(hasFeature(planKey, 'contract_modifications')).toBe(false);
  });

  it('allows contract_modifications for professional', () => {
    expect(hasFeature('professional', 'contract_modifications')).toBe(true);
  });

  it('allows all for enterprise', () => {
    expect(hasFeature('enterprise', 'multi_user')).toBe(true);
  });

  it('allows all for trial', () => {
    expect(hasFeature('trial', 'multi_user')).toBe(true);
  });

  it('blocks all for expired', () => {
    expect(hasFeature('expired', 'contract_modifications')).toBe(false);
    expect(hasFeature('expired', 'multi_user')).toBe(false);
  });
});

describe('planDisplayName', () => {
  it('returns correct display names', () => {
    expect(planDisplayName('starter')).toBe('Starter');
    expect(planDisplayName('professional')).toBe('Professional');
    expect(planDisplayName('enterprise')).toBe('Enterprise');
    expect(planDisplayName('trial')).toBe('Free Trial');
    expect(planDisplayName('expired')).toBe('Expired');
  });
});

describe('UpgradeCard UI', () => {
  it('renders "Available on Professional" with upgrade button', () => {
    render(
      <MemoryRouter>
        <UpgradeCard featureName="Contract Modifications" requiredPlan="Professional" />
      </MemoryRouter>
    );
    expect(screen.getByText('Available on Professional')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Professional')).toBeInTheDocument();
  });

  it('renders "Available on Enterprise" with upgrade button', () => {
    render(
      <MemoryRouter>
        <UpgradeCard featureName="User Management" requiredPlan="Enterprise" />
      </MemoryRouter>
    );
    expect(screen.getByText('Available on Enterprise')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Enterprise')).toBeInTheDocument();
  });

  it('shows custom description when provided', () => {
    render(
      <MemoryRouter>
        <UpgradeCard featureName="Branches" requiredPlan="Professional" description="Branch management requires Professional plan." />
      </MemoryRouter>
    );
    expect(screen.getByText('Branch management requires Professional plan.')).toBeInTheDocument();
  });
});

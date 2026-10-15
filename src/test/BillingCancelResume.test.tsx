import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const samplePlans = [
  {
    id: 'plan-1',
    plan_key: 'starter',
    plan_name: 'Starter',
    max_leases: 50,
    price_monthly: 200,
    price_annually: 2040,
    features: ['Up to 50 leases', 'Core ASC 842 schedules'],
    is_active: true,
    sort_order: 1,
    stripe_price_id_monthly: 'price_starter_monthly',
    stripe_price_id_annually: 'price_starter_annually',
  },
  {
    id: 'plan-2',
    plan_key: 'professional',
    plan_name: 'Professional',
    max_leases: 100,
    price_monthly: 300,
    price_annually: 3060,
    features: ['Up to 100 leases', 'Lease modifications'],
    is_active: true,
    sort_order: 2,
    stripe_price_id_monthly: 'price_pro_monthly',
    stripe_price_id_annually: 'price_pro_annually',
  },
  {
    id: 'plan-3',
    plan_key: 'enterprise',
    plan_name: 'Enterprise',
    max_leases: 200,
    price_monthly: 500,
    price_annually: 5100,
    features: ['Up to 200 leases', 'Multi-user access'],
    is_active: true,
    sort_order: 3,
    stripe_price_id_monthly: 'price_ent_monthly',
    stripe_price_id_annually: 'price_ent_annually',
  },
];

const activeStripeSub = {
  customer_id: 'cus_test123',
  subscription_id: 'sub_test123',
  subscription_status: 'active',
  price_id: 'price_ent_monthly',
  current_period_start: Math.floor(Date.now() / 1000) - 86400,
  current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
  cancel_at_period_end: false,
  payment_method_brand: 'visa',
  payment_method_last4: '4242',
  plan_key: 'enterprise',
  billing_cycle: 'monthly',
  internal_status: 'active',
  trial_ends_at: null,
  internal_period_end: null,
};

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { BillingView } from '../components/BillingView';

function mockBillingData(overrides: Record<string, unknown> = {}) {
  return {
    plans: samplePlans,
    currentSubscription: {
      id: 'sub-1',
      plan_key: 'enterprise',
      billing_cycle: 'monthly' as const,
      status: 'active' as const,
      trial_ends_at: null,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 86400000 * 30).toISOString(),
    },
    stripeSubscription: activeStripeSub,
    orders: [],
    invoices: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    getSessionToken: vi.fn().mockResolvedValue('mock-token'),
    ...overrides,
  };
}

vi.mock('../hooks/useBillingData', () => ({
  useBillingData: () => mockBillingData(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ cancel_at_period_end: true, current_period_end: '2026-11-14T00:00:00.000Z' }),
  } as never);
});

describe('BillingView cancel/resume', () => {
  it('shows Cancel button for an active Stripe subscription', async () => {
    render(
      <MemoryRouter>
        <BillingView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Cancel subscription')).toBeInTheDocument();
    });
  });

  it('shows the cancel confirmation dialog with the period end date and non-refundable notice', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BillingView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Cancel subscription')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cancel subscription'));

    expect(screen.getByText('Cancel subscription?')).toBeInTheDocument();
    const dialog = screen.getByText('Cancel subscription?').closest('.border-red-200');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toMatch(/non-refundable/i);
    expect(dialog!.textContent).toMatch(/read-only/i);
  });

  it('calls the manage-subscription edge function with action: cancel', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BillingView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Cancel subscription')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cancel subscription'));
    await user.click(screen.getByText('Yes, cancel at period end'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/stripe-manage-subscription'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer mock-token' }),
          body: expect.stringContaining('"action":"cancel"'),
        })
      );
    });
  });
});

describe('BillingView non-Stripe plan display', () => {
  it('shows honest message for manually-set plan without Stripe', async () => {
    vi.doMock('../hooks/useBillingData', () => ({
      useBillingData: () => mockBillingData({
        stripeSubscription: null,
      }),
    }));
    // Re-import to get the mocked version
    vi.resetModules();
    const { BillingView: FreshBillingView } = await import('../components/BillingView');
    render(
      <MemoryRouter>
        <FreshBillingView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/set up by the administrator, not billed through Stripe/i)).toBeInTheDocument();
    });
    // No Cancel button when there's no Stripe subscription.
    expect(screen.queryByText('Cancel subscription')).not.toBeInTheDocument();
  });
});

describe('BillingView renewal disclosure', () => {
  it('shows renewal terms with a link to the Terms', async () => {
    render(
      <MemoryRouter>
        <BillingView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/renew automatically/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/non-refundable/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/legal/terms');
  });
});

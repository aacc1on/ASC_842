import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const samplePlans = [
  {
    id: 'plan-1',
    plan_key: 'starter',
    plan_name: 'Starter',
    max_leases: 10,
    price_monthly: 2900,
    price_annually: 29400,
    features: ['Up to 10 leases', 'Basic reports'],
    is_active: true,
    sort_order: 1,
    stripe_price_id_monthly: 'price_starter_monthly',
    stripe_price_id_annually: 'price_starter_annually',
  },
  {
    id: 'plan-2',
    plan_key: 'professional',
    plan_name: 'Professional',
    max_leases: 50,
    price_monthly: 8900,
    price_annually: 90600,
    features: ['Up to 50 leases', 'Advanced reports'],
    is_active: true,
    sort_order: 2,
    stripe_price_id_monthly: 'price_pro_monthly',
    stripe_price_id_annually: 'price_pro_annually',
  },
];

vi.mock('../hooks/useBillingData', () => ({
  useBillingData: () => ({
    plans: samplePlans,
    currentSubscription: null,
    stripeSubscription: null,
    orders: [],
    invoices: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    getSessionToken: vi.fn().mockResolvedValue('mock-token'),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { BillingView } from '../components/BillingView';

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/session123' }),
  } as never);
});

describe('Billing checkout', () => {
  it('calls stripe-checkout with the plan price_id and success_url ending in /billing?billing_success=true', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <BillingView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Starter')).toBeInTheDocument();
    });

    const subscribeBtn = screen.getAllByRole('button', { name: /subscribe/i })[0];
    await user.click(subscribeBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/stripe-checkout'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
          body: expect.stringContaining('price_starter_monthly'),
        })
      );
    });

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.success_url).toContain('/billing?billing_success=true');
    expect(body.cancel_url).toContain('/billing?billing_cancel=true');
    expect(body.mode).toBe('subscription');
  });
});

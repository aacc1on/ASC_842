import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const plans = [
  { id: 'p1', plan_key: 'starter', plan_name: 'Starter', max_leases: 50, price_monthly: 200, price_annually: 2040, features: [], is_active: true, sort_order: 1, stripe_price_id_monthly: 'price_sm', stripe_price_id_annually: 'price_sa' },
  { id: 'p3', plan_key: 'enterprise', plan_name: 'Enterprise', max_leases: 200, price_monthly: 500, price_annually: 5100, features: [], is_active: true, sort_order: 3, stripe_price_id_monthly: 'price_em', stripe_price_id_annually: 'price_ea' },
];

const reload = vi.fn();
const sync = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/useBillingData', () => ({
  useBillingData: () => ({
    plans,
    currentSubscription: {
      id: 's', plan_key: 'starter', billing_cycle: 'monthly', status: 'active', trial_ends_at: null,
      current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 864e5 * 30).toISOString(),
    },
    stripeSubscription: {
      customer_id: 'cus_1', subscription_id: 'sub_1', subscription_status: 'active', price_id: 'price_sm',
      current_period_start: 1, current_period_end: Math.floor(Date.now() / 1000) + 864e3, cancel_at_period_end: false,
      payment_method_brand: 'visa', payment_method_last4: '4242', plan_key: 'starter', billing_cycle: 'monthly',
      internal_status: 'active', trial_ends_at: null, internal_period_end: null,
    },
    orders: [], invoices: [], loading: false, error: null, reload, sync,
    getSessionToken: vi.fn().mockResolvedValue('tok'),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { BillingView } from '../components/BillingView';

function respond(status: number, body: unknown) {
  return { ok: status < 400, status, headers: { get: () => null }, json: vi.fn().mockResolvedValue(body) };
}

function renderAt(path = '/billing') {
  return render(<MemoryRouter initialEntries={[path]}><BillingView /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe('BillingView plan switching', () => {
  it('offers Switch to <plan> instead of a second checkout', () => {
    renderAt();
    expect(screen.getByRole('button', { name: /Switch to Enterprise/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subscribe/ })).not.toBeInTheDocument();
  });

  it('shows the proration preview and confirms the switch', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce(respond(200, {
        plan_key: 'enterprise', plan_name: 'Enterprise', billing_cycle: 'monthly', amount_due: 15000, total: 15000,
        currency: 'usd', proration_date: 1700000000, lines: [{ description: 'Remaining time on Enterprise', amount: 15000 }],
      }))
      .mockResolvedValueOnce(respond(200, { changed: true }));
    renderAt();

    await user.click(screen.getByRole('button', { name: /Switch to Enterprise/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/\$150\.00/);
    expect(dialog.textContent).toMatch(/Remaining time on Enterprise/);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ action: 'preview', plan_key: 'enterprise', billing_cycle: 'monthly' });

    await user.click(screen.getByRole('button', { name: /Confirm switch/ }));
    await waitFor(() => expect(screen.getByText(/now on the Enterprise plan/)).toBeInTheDocument());
    expect(String(mockFetch.mock.calls[1][0])).toMatch(/stripe-change-plan$/);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({ action: 'confirm', proration_date: 1700000000 });
    expect(reload).toHaveBeenCalled();
  });

  it('shows why a downgrade is blocked', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(respond(409, { error: 'You have 3 users, but Enterprise allows 1. Remove 2 users first.', code: 'PLAN_LIMIT_EXCEEDED' }));
    renderAt();
    await user.click(screen.getByRole('button', { name: /Switch to Enterprise/ }));
    expect(await screen.findByText(/Remove 2 users first/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BillingView Manage billing', () => {
  it('shows a clear message when the portal fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(respond(502, { error: 'x', code: 'PORTAL_STRIPE_ERROR' }));
    renderAt();
    await user.click(screen.getByRole('button', { name: /Manage billing/ }));
    expect(await screen.findByText(/Stripe could not open the billing portal/)).toBeInTheDocument();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).return_url).toMatch(/\/billing\?portal_return=1$/);
  });

  it('refreshes billing when returning from the portal', async () => {
    renderAt('/billing?portal_return=1');
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  });
});

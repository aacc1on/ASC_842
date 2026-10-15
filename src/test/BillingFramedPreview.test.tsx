import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/useBillingData', () => ({
  useBillingData: () => ({
    plans: [],
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
    orders: [], invoices: [], loading: false, error: null, reload: vi.fn(), sync: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('tok'),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { BillingView } from '../components/BillingView';
import { isFramed, prepareExternalNavigation } from '../utils/externalNavigation';

const PORTAL_URL = 'https://billing.stripe.com/p/session/test_123';

function respond(status: number, body: unknown) {
  return { ok: status < 400, status, headers: { get: () => null }, json: vi.fn().mockResolvedValue(body) };
}

function renderBilling() {
  return render(<MemoryRouter initialEntries={['/billing']}><BillingView /></MemoryRouter>);
}

function frameWindow() {
  vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('external navigation helper', () => {
  it('detects framing', () => {
    expect(isFramed()).toBe(false);
    frameWindow();
    expect(isFramed()).toBe(true);
  });

  it('navigates the same tab when not framed', () => {
    const open = vi.spyOn(window, 'open');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    expect(prepareExternalNavigation().go(PORTAL_URL)).toBe('same-tab');
    expect(assign).toHaveBeenCalledWith(PORTAL_URL);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('Manage billing inside a framed preview', () => {
  it('opens the portal in a new tab with no opener', async () => {
    frameWindow();
    const tab = { closed: false, opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(respond(200, { url: PORTAL_URL }));
    const user = userEvent.setup();
    renderBilling();

    await user.click(screen.getByRole('button', { name: /Manage billing/ }));

    await waitFor(() => expect(tab.location.href).toBe(PORTAL_URL));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(/opened in a new tab/)).toBeInTheDocument();
  });

  it('shows a clickable link when the popup is blocked', async () => {
    frameWindow();
    vi.spyOn(window, 'open').mockReturnValue(null);
    mockFetch.mockResolvedValueOnce(respond(200, { url: PORTAL_URL }));
    const user = userEvent.setup();
    renderBilling();

    await user.click(screen.getByRole('button', { name: /Manage billing/ }));

    const link = await screen.findByRole('link', { name: /Open it in a new tab/ });
    expect(link).toHaveAttribute('href', PORTAL_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(screen.getByText(/blocked the new tab/)).toBeInTheDocument();
  });

  it('closes the blank tab and shows the error when the portal function fails', async () => {
    frameWindow();
    const tab = { closed: false, opener: null, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    mockFetch.mockResolvedValueOnce(respond(502, { error: 'x', code: 'PORTAL_STRIPE_ERROR' }));
    const user = userEvent.setup();
    renderBilling();

    await user.click(screen.getByRole('button', { name: /Manage billing/ }));

    expect(await screen.findByText(/Stripe could not open the billing portal/)).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });
});

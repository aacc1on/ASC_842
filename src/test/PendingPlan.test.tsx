import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Auth } from '../components/Auth';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

vi.mock('../hooks/useBillingData', () => ({
  useBillingData: () => ({
    plans: [
      { plan_key: 'professional', plan_name: 'Professional', price_monthly: 300, price_annually: 3060, stripe_price_id_monthly: 'price_test_m', stripe_price_id_annually: 'price_test_a', max_leases: 100, features: [] },
    ],
    currentSubscription: null,
    stripeSubscription: null,
    orders: [],
    invoices: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    getSessionToken: vi.fn(async () => 'fake-token'),
  }),
}));

import { supabase } from '../lib/supabase';

const mockedSignUp = vi.mocked(supabase.auth.signUp);
const mockedSignIn = vi.mocked(supabase.auth.signInWithPassword);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockedSignUp.mockResolvedValue({ data: { user: { id: 'u1', email: 't@t.com' } }, error: null } as never);
  mockedSignIn.mockResolvedValue({ data: {}, error: null } as never);
});

afterEach(() => {
  localStorage.clear();
});

describe('Auth — plan selection in signUp', () => {
  it('passes plan_key and billing_cycle in signUp options.data', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    // Switch to signup mode
    await user.click(screen.getByText('Start free trial'));

    // We need to simulate selecting a plan. The LandingPage is hidden on small screens
    // but rendered in the DOM. Find the "Get started" button for professional plan.
    // The LandingPage buttons call onSelectPlan which sets selectedPlan and selectedBilling.
    const getStartedButtons = screen.getAllByText('Get started');
    // Click the second one (professional — index 1 in the plans array)
    // First is starter, second is professional, third is enterprise
    await user.click(getStartedButtons[1]);

    await user.type(screen.getByPlaceholderText('you@company.com'), 'bob@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password12345');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledTimes(1);
    });

    const callArg = mockedSignUp.mock.calls[0][0] as { email: string; password: string; options?: { data?: Record<string, unknown> } };
    expect(callArg.email).toBe('bob@test.com');
    expect(callArg.password).toBe('password12345');
    expect(callArg.options).toBeDefined();
    expect(callArg.options!.data).toEqual({ terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15', plan_key: 'professional', billing_cycle: 'monthly' });
  });

  it('saves pendingPlan to localStorage on signUp with a plan', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Start free trial'));

    const getStartedButtons = screen.getAllByText('Get started');
    await user.click(getStartedButtons[2]); // enterprise

    // Switch to annual billing
    const annualButton = screen.getByText('Annual');
    await user.click(annualButton);

    // Re-select the plan after changing billing
    const getStartedButtonsAfter = screen.getAllByText('Get started');
    await user.click(getStartedButtonsAfter[2]); // enterprise with annual

    await user.type(screen.getByPlaceholderText('you@company.com'), 'carol@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password12345');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledTimes(1);
    });

    const raw = localStorage.getItem('pendingPlan');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.plan_key).toBe('enterprise');
    expect(parsed.billing_cycle).toBe('annually');
  });

  it('shows the plan display name and price on the signup form', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Start free trial'));

    const getStartedButtons = screen.getAllByText('Get started');
    await user.click(getStartedButtons[1]); // professional, monthly

    // The signup form should show "Professional plan — $300/mo, billed monthly"
    await waitFor(() => {
      expect(screen.getByText(/Professional plan/)).toBeInTheDocument();
    });
    const planText = screen.getByText(/Professional plan/);
    expect(planText.textContent).toContain('$300/mo, billed monthly');
  });

  it('shows annual price label when annual billing is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Start free trial'));

    // Select annual billing
    const annualButton = screen.getByText('Annual');
    await user.click(annualButton);

    const getStartedButtons = screen.getAllByText('Get started');
    await user.click(getStartedButtons[1]); // professional, annual

    await waitFor(() => {
      expect(screen.getByText(/Professional plan/)).toBeInTheDocument();
    });
    const planText = screen.getByText(/Professional plan/);
    expect(planText.textContent).toContain('$255/mo, billed annually');
  });

  it('sends only the legal acceptance in options.data when no plan is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Start free trial'));

    await user.type(screen.getByPlaceholderText('you@company.com'), 'noplan@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password12345');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledTimes(1);
    });

    const callArg = mockedSignUp.mock.calls[0][0] as { email: string; password: string; options?: { data?: Record<string, unknown> } };
    expect(callArg.options).toEqual({ captchaToken: expect.any(String), data: { terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15' } });
    expect(localStorage.getItem('pendingPlan')).toBeNull();
  });
});

describe('Pending plan handoff to Billing', () => {
  it('BillingView shows CTA when pending_plan query param is present', async () => {
    localStorage.setItem('pendingPlan', JSON.stringify({ plan_key: 'professional', billing_cycle: 'monthly' }));

    const { BillingView } = await import('../components/BillingView');

    render(
      <MemoryRouter initialEntries={['/billing?pending_plan=professional&pending_cycle=monthly']}>
        <Routes>
          <Route path="/billing" element={<BillingView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Complete your subscription')).toBeInTheDocument();
    });
    expect(screen.getByText(/Professional plan/)).toBeInTheDocument();
    const ctaText = screen.getByText(/Professional plan/);
    expect(ctaText.textContent).toContain('$300/mo, billed monthly');

    vi.resetModules();
  });

  it('clears pendingPlan from localStorage on billing_success', async () => {
    localStorage.setItem('pendingPlan', JSON.stringify({ plan_key: 'professional', billing_cycle: 'monthly' }));

    const { BillingView } = await import('../components/BillingView');

    render(
      <MemoryRouter initialEntries={['/billing?billing_success=true']}>
        <Routes>
          <Route path="/billing" element={<BillingView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Payment successful/)).toBeInTheDocument();
    });

    expect(localStorage.getItem('pendingPlan')).toBeNull();

    vi.resetModules();
  });
});

/**
 * Flow test: sign-up with plan selection -> trial -> billing CTA -> Stripe checkout.
 *
 * Renders the real Auth screen (with its LandingPage plan picker), then the real
 * SubscriptionBanner + BillingView (with the real useBillingData hook and
 * fetchMyPlan) inside a MemoryRouter, on top of the in-memory Supabase fake.
 * Only the stripe-checkout edge function call is stubbed (global fetch).
 *
 * App.tsx is not mounted (it pulls in every module); `SignedInShell` below
 * reproduces the two App.tsx behaviours this flow depends on: the banner shown
 * for an expired / past-due plan, and the private `PendingPlanRedirect` that
 * sends a signed-in user with a stored `pendingPlan` to /billing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Auth } from '../../components/Auth';
import { BillingView } from '../../components/BillingView';
import { SubscriptionBanner } from '../../components/SubscriptionBanner';
import { fetchMyPlan, type MyPlan } from '../../utils/planFeatures';
import { createFakeSupabase } from '../fixtures/fakeSupabase';
import { GOLDEN_TODAY, GOLDEN_USER, type Row, type Tables } from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }),
}));

const SUPABASE_URL = 'https://flow-test.supabase.co';
const EMAIL = 'new.user@company.com';
const PASSWORD = 'correct-horse-battery';

const PLAN_ROWS: Row[] = [
  {
    id: 'plan-1', plan_key: 'starter', plan_name: 'Starter', max_leases: 50, price_monthly: 200, price_annually: 2040,
    features: ['Up to 50 active leases', 'ASC 842 Compliance'], is_active: true, sort_order: 1,
    stripe_price_id_monthly: 'price_starter_m', stripe_price_id_annually: 'price_starter_y',
  },
  {
    id: 'plan-2', plan_key: 'professional', plan_name: 'Professional', max_leases: 100, price_monthly: 300, price_annually: 3060,
    // Stored as a JSON string, like the jsonb text the API can return.
    features: '["Up to 100 active leases","Contract modifications"]', is_active: true, sort_order: 2,
    stripe_price_id_monthly: 'price_pro_m', stripe_price_id_annually: 'price_pro_y',
  },
  {
    id: 'plan-3', plan_key: 'enterprise', plan_name: 'Enterprise', max_leases: 200, price_monthly: 500, price_annually: 5100,
    features: ['Up to 200 active leases'], is_active: true, sort_order: 3,
    stripe_price_id_monthly: null, stripe_price_id_annually: 'price_ent_y',
  },
  {
    id: 'plan-x', plan_key: 'legacy', plan_name: 'Legacy', max_leases: 5, price_monthly: 1, price_annually: 12,
    features: [], is_active: false, sort_order: 0, stripe_price_id_monthly: 'price_legacy', stripe_price_id_annually: null,
  },
];

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
let myPlan: MyPlan | null;
let signUpResult: { data: unknown; error: { message: string } | null };
const signUp = vi.fn();
const fetchMock = vi.fn();

function setup() {
  tables = {
    subscription_plans: PLAN_ROWS.map((r) => ({ ...r })),
    subscriptions: [],
    stripe_user_subscriptions: [],
    stripe_org_subscriptions: [],
    stripe_org_invoices: [],
    stripe_user_orders: [],
  };
  myPlan = null;
  signUpResult = { data: { user: { id: GOLDEN_USER }, session: null }, error: null };
  fake = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    email: EMAIL,
    rpc: { get_my_plan: () => myPlan },
  });
  signUp.mockReset();
  signUp.mockImplementation(async () => signUpResult);
  h.client = { ...fake, auth: { ...fake.auth, signUp } };
}

/** The org's subscription row the sign-up trigger creates (trialing, 5-day trial). */
function startTrial(planKey: string, cycle: 'monthly' | 'annually', daysLeft = 5) {
  const ends = new Date(new Date(GOLDEN_TODAY).getTime() + daysLeft * 86_400_000).toISOString();
  tables.subscriptions.push({
    id: 'sub-1', plan_key: planKey, billing_cycle: cycle, status: 'trialing', trial_ends_at: ends,
    current_period_start: '2026-10-12T00:00:00Z', current_period_end: ends,
  });
  myPlan = {
    plan_key: 'trial', status: 'trialing', trial_ends_at: ends, days_left: daysLeft,
    features: { contract_modifications: true, branches: true, multi_user: true },
  };
}

function okCheckout(url = 'https://checkout.stripe.com/c/pay/cs_test_123') {
  fetchMock.mockImplementation((reqUrl: string) => {
    if (reqUrl.includes('stripe-billing-sync')) {
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ synced: false }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ url: url ?? null }) });
  });
}

/** Mirrors App.tsx: banner for expired / past-due plans, pending-plan redirect, /billing route. */
function SignedInShell() {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    fetchMyPlan().then((p) => { setPlan(p); setLoaded(true); });
  }, []);
  useEffect(() => {
    if (location.pathname === '/billing') return;
    const raw = localStorage.getItem('pendingPlan');
    const pending = raw ? (JSON.parse(raw) as { plan_key: string; billing_cycle: string }) : null;
    if (pending?.plan_key) {
      navigate(`/billing?pending_plan=${encodeURIComponent(pending.plan_key)}&pending_cycle=${encodeURIComponent(pending.billing_cycle)}`, { replace: true });
    }
  }, [navigate, location.pathname]);
  if (!loaded) return null;
  const planKey = plan?.plan_key ?? 'expired';
  const active = plan !== null && planKey !== 'expired';
  const pastDue = plan?.status === 'past_due' ? plan.days_left : null;
  return (
    <>
      {!active && <SubscriptionBanner variant="inactive" planKey={planKey} daysLeft={plan?.days_left ?? null} trialEndsAt={plan?.trial_ends_at ?? null} />}
      {active && pastDue !== null && <SubscriptionBanner variant="pastDue" daysRemaining={pastDue} />}
      <Routes>
        <Route path="/" element={<h1>Dashboard</h1>} />
        <Route path="/billing" element={<BillingView myPlan={plan} />} />
      </Routes>
    </>
  );
}

function renderSignedIn(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SignedInShell />
    </MemoryRouter>,
  );
}

async function signUpWithPlan(planIndex: number, opts: { annual?: boolean; password?: string } = {}) {
  const user = userEvent.setup();
  render(<Auth />);
  if (opts.annual) await user.click(screen.getByRole('button', { name: /^Annual/ }));
  await user.click(screen.getAllByRole('button', { name: /Get started/ })[planIndex]);
  await user.type(screen.getByPlaceholderText('you@company.com'), EMAIL);
  await user.type(screen.getByPlaceholderText('Min. 12 characters'), opts.password ?? PASSWORD);
  return user;
}

const checkoutBody = (i = 0) => {
  const checkoutCalls = fetchMock.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
  return JSON.parse(String((checkoutCalls[i][1] as RequestInit).body)) as Record<string, string>;
};

const ORIGINAL_URL = window.location.href;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_TODAY));
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  okCheckout();
  localStorage.clear();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  // A successful checkout navigates the window to Stripe; put it back for the next test.
  (window as unknown as { happyDOM?: { setURL(url: string): void } }).happyDOM?.setURL(ORIGINAL_URL);
});

describe('Sign-up -> trial -> billing -> checkout flow', () => {
  it('journey: picks Professional, signs up, lands on billing with the trial and pending plan, and starts Stripe checkout', async () => {
    const user = await signUpWithPlan(1);
    expect(screen.getByText('Professional plan — $300/mo, billed monthly')).toBeInTheDocument();
    expect(screen.getByText(/5-day free trial · No credit card required/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /Create Account/ }));

    expect(await screen.findByText('Thanks! If this email address is new, your account has been created. Please sign in to continue.')).toBeInTheDocument();
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      options: { captchaToken: expect.stringMatching(/^test-captcha-token-/), data: { terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15', plan_key: 'professional', billing_cycle: 'monthly' } },
    });
    expect(JSON.parse(localStorage.getItem('pendingPlan')!)).toEqual({ plan_key: 'professional', billing_cycle: 'monthly' });
    expect(screen.getByRole('button', { name: /Create Account/ })).toBeDisabled();

    // Server side: the new org starts a trial. The user signs in and is redirected to billing.
    startTrial('professional', 'monthly');
    cleanup();
    renderSignedIn('/');

    expect(await screen.findByText('Complete your subscription')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByText(/You selected the Professional plan — \$300\/mo, billed monthly\./)).toBeInTheDocument();
    expect(screen.getAllByText('Free Trial').length).toBeGreaterThan(0);
    expect(screen.getByText(/^5 days remaining in your free trial — ends /)).toBeInTheDocument();
    // Trial is active: no inactive banner.
    expect(screen.queryByText(/Your free trial has ended|Your subscription is inactive/)).not.toBeInTheDocument();
    // Only active plans are offered; features stored as JSON text are parsed.
    expect(screen.queryByText('Legacy')).not.toBeInTheDocument();
    expect(screen.getByText('Contract modifications')).toBeInTheDocument();
    expect(fake.calls.filter((c) => c.fn === 'get_my_plan')).toHaveLength(1);

    const origin = window.location.origin;
    await user.click(screen.getByRole('button', { name: /Complete Subscription/ }));

    await waitFor(() => {
      const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
      expect(checkoutCall).toBeDefined();
    });
    const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout')) as [string, RequestInit];
    const [url, init] = checkoutCall;
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/stripe-checkout`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(checkoutBody()).toEqual({
      price_id: 'price_pro_m',
      mode: 'subscription',
      success_url: `${origin}/billing?billing_success=true`,
      cancel_url: `${origin}/billing?billing_cancel=true`,
    });
    // The browser is sent to the Stripe-hosted checkout page returned by the edge function.
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test_123'));
    // Nothing is written from the browser: the subscription changes only via the Stripe webhook.
    expect(fake.writes).toHaveLength(0);
  });

  it('annual plan choice is carried through sign-up metadata and the checkout price', async () => {
    const user = await signUpWithPlan(2, { annual: true });
    expect(screen.getByText('Enterprise plan — $425/mo, billed annually')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /Create Account/ }));
    await screen.findByText(/Thanks! If this email address is new/);
    expect(signUp.mock.calls[0][0]).toMatchObject({ options: { data: { plan_key: 'enterprise', billing_cycle: 'annually' } } });

    startTrial('enterprise', 'annually');
    cleanup();
    renderSignedIn('/');
    expect(await screen.findByText('Complete your subscription')).toBeInTheDocument();
    expect(screen.getByText(/You selected the Enterprise plan — .*billed annually/)).toBeInTheDocument();
    // Annual cycle preselected: the card shows the yearly bill.
    expect(screen.getByText('Billed $5100/yr')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Complete Subscription/ }));
    await waitFor(() => {
      const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
      expect(checkoutCall).toBeDefined();
    });
    const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout')) as [string, RequestInit];
    expect(JSON.parse(String(checkoutCall[1].body))).toEqual(expect.objectContaining({ price_id: 'price_ent_y' }));
  });

  it('sign-up guards: short password and an already-registered email', async () => {
    const user = await signUpWithPlan(0, { password: 'short-pass' });
    fireEvent.submit(screen.getByRole('button', { name: /Create Account/ }).closest('form')!);
    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
    expect(localStorage.getItem('pendingPlan')).toBeNull();

    // Existing account: same neutral message (no account enumeration).
    signUpResult = { data: { user: null, session: null }, error: { message: 'User already registered' } };
    const pw = screen.getByPlaceholderText('Min. 12 characters');
    await user.clear(pw);
    await user.type(pw, PASSWORD);
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /Create Account/ }));
    expect(await screen.findByText('Thanks! If this email address is new, your account has been created. Please sign in to continue.')).toBeInTheDocument();
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it('sign-up without a plan (Start free trial link) sends no plan metadata and stores no pending plan', async () => {
    const user = userEvent.setup();
    render(<Auth />);
    await user.click(screen.getByRole('button', { name: 'Start free trial' }));
    await user.type(screen.getByPlaceholderText('you@company.com'), EMAIL);
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), PASSWORD);
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /Create Account/ }));
    await screen.findByText(/Thanks! If this email address is new/);
    expect(signUp).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD, options: { captchaToken: expect.stringMatching(/^test-captcha-token-/), data: { terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15' } } });
    expect(localStorage.getItem('pendingPlan')).toBeNull();

    startTrial('starter', 'monthly');
    cleanup();
    renderSignedIn('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('expired trial: banner blocks writes, "Go to Billing" opens billing, Subscribe starts checkout for the chosen plan', async () => {
    startTrial('professional', 'monthly', 0);
    myPlan = { ...myPlan!, plan_key: 'expired', status: 'expired', days_left: 0 };
    tables.subscriptions[0].trial_ends_at = '2026-10-01T00:00:00Z';
    const user = userEvent.setup();
    renderSignedIn('/');

    // An ended trial (trial_ends_at set, 0 days left) gets the trial-specific wording.
    expect(await screen.findByText('Your free trial has ended')).toBeInTheDocument();
    expect(screen.getByText(/creating, editing, or deleting is disabled until you subscribe/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to Billing/ }));

    expect(await screen.findByRole('heading', { name: 'Billing & Subscription' })).toBeInTheDocument();
    expect(screen.getByText('Trial has ended')).toBeInTheDocument();
    expect(screen.queryByText('Complete your subscription')).not.toBeInTheDocument();
    // Trial plan card offers "Renew Plan"; a plan without a monthly Stripe price is "Contact Sales".
    expect(screen.getByRole('button', { name: /Renew Plan/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Contact Sales' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /^Subscribe/ }));
    await waitFor(() => {
      const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
      expect(checkoutCall).toBeDefined();
    });
    const checkoutCall = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('stripe-checkout')) as [string, RequestInit];
    expect(JSON.parse(String(checkoutCall[1].body))).toEqual(expect.objectContaining({ price_id: 'price_starter_m' }));
  });

  it('trial plan with zero days left shows "Your free trial has ended"; past-due shows the grace banner', async () => {
    myPlan = { plan_key: 'trial', status: 'trialing', trial_ends_at: '2026-10-11T00:00:00Z', days_left: 0, features: { contract_modifications: true, branches: true, multi_user: true } };
    // get_my_plan for an ended trial reports "expired" to the app.
    h.client = { ...h.client, rpc: (fn: string, args?: Record<string, unknown>) => (fn === 'get_my_plan' ? Promise.resolve({ data: null, error: { message: 'no plan' } }) : fake.rpc(fn, args)) };
    renderSignedIn('/');
    expect(await screen.findByText('Your subscription is inactive')).toBeInTheDocument();
    cleanup();

    // SubscriptionBanner's own "trial ended" wording for a trial key with no days left.
    render(
      <MemoryRouter>
        <SubscriptionBanner variant="inactive" planKey="trial" daysLeft={0} trialEndsAt="2026-10-11T00:00:00Z" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Your free trial has ended')).toBeInTheDocument();
    cleanup();

    setup();
    startTrial('starter', 'monthly');
    myPlan = { ...myPlan!, plan_key: 'starter', status: 'past_due', days_left: 3 };
    const user = userEvent.setup();
    renderSignedIn('/');
    expect(await screen.findByText('Payment failed — update billing within 3 days')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Update Billing/ }));
    expect(await screen.findByRole('heading', { name: 'Billing & Subscription' })).toBeInTheDocument();
  });

  it('checkout errors: server failure shows a safe message; rate limit is explained; nothing redirects', async () => {
    startTrial('professional', 'monthly');
    let checkoutShouldFail = true;
    fetchMock.mockImplementation((reqUrl: string) => {
      if (reqUrl.includes('stripe-billing-sync')) {
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ synced: false }) });
      }
      if (reqUrl.includes('stripe-checkout')) {
        if (checkoutShouldFail) {
          return Promise.resolve({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: 'relation "stripe_customers" does not exist' }) });
        }
        return Promise.resolve({ ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) });
    });
    const user = userEvent.setup();
    renderSignedIn('/billing');
    await screen.findByRole('heading', { name: 'Billing & Subscription' });

    await user.click(screen.getByRole('button', { name: /^Subscribe/ }));
    expect(await screen.findByText('Failed to start checkout. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/stripe_customers/)).not.toBeInTheDocument();

    checkoutShouldFail = false;
    await user.click(screen.getByRole('button', { name: /^Subscribe/ }));
    expect(await screen.findByText(/^Too many requests\. Please wait .+ and try again\.$/)).toBeInTheDocument();
    const checkoutCalls = fetchMock.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
    expect(checkoutCalls).toHaveLength(2);
  });

  it('checkout without a session is refused before calling the edge function', async () => {
    startTrial('professional', 'monthly');
    h.client = { ...h.client, auth: { ...fake.auth, signUp, getSession: () => Promise.resolve({ data: { session: null }, error: null }) } };
    const user = userEvent.setup();
    renderSignedIn('/billing');
    await screen.findByRole('heading', { name: 'Billing & Subscription' });
    await user.click(screen.getByRole('button', { name: /^Subscribe/ }));
    expect(await screen.findByText('Your session has expired. Please sign in again.')).toBeInTheDocument();
    const checkoutCalls = fetchMock.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
    expect(checkoutCalls).toHaveLength(0);
  });

  it('returning from Stripe: success clears the pending plan and the query string', async () => {
    startTrial('professional', 'monthly');
    localStorage.setItem('pendingPlan', JSON.stringify({ plan_key: 'professional', billing_cycle: 'monthly' }));
    renderSignedIn('/billing?billing_success=true');
    expect(await screen.findByText('Payment successful! Your subscription is now active.')).toBeInTheDocument();
    expect(localStorage.getItem('pendingPlan')).toBeNull();
    expect(screen.queryByText('Complete your subscription')).not.toBeInTheDocument();
    const checkoutCalls = fetchMock.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('stripe-checkout'));
    expect(checkoutCalls).toHaveLength(0);
  });

  it('returning from Stripe with billing_cancel shows "no charge"', async () => {
    startTrial('professional', 'monthly');
    renderSignedIn('/billing?billing_cancel=true');
    await screen.findByRole('heading', { name: 'Billing & Subscription' });
    expect(await screen.findByText('Checkout was cancelled. No charge was made.', {}, { timeout: 1500 })).toBeInTheDocument();
  });
});

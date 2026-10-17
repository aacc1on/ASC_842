import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, preflightResponse, isAllowedOrigin } from '../_shared/cors.ts';
import { checkRateLimit, clientIp, tooManyRequests } from '../_shared/rateLimit.ts';
import { logServerError, readAlertConfig } from '../_shared/alerts.ts';
import { maskId } from '../_shared/billingRules.ts';
import { ensurePortalConfiguration, loadOrgStripeState, stripeClient } from '../_shared/stripeOrg.ts';

function corsResponse(req: Request, body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function safeOrigin(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try { return new URL(url).origin; } catch { return null; }
}

async function openPortal(stripe: Stripe, admin: SupabaseClient, orgId: string, returnUrl: string) {
  const state = await loadOrgStripeState(stripe, admin, orgId);
  const customer = state.primaryCustomer ?? state.customers[0] ?? null;
  if (!customer) return { customer: null, state, session: null, configId: null };
  const configId = await ensurePortalConfiguration(stripe, admin);
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.customer_id, return_url: returnUrl, configuration: configId,
  });
  return { customer, state, session, configId };
}

// Operator check unlocked by a single-use database pass: proves Stripe accepts our configuration. Never returns the session URL.
async function diagnose(req: Request, admin: SupabaseClient, stripe: Stripe, body: Record<string, unknown>) {
  const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
  const returnUrl = typeof body.return_url === 'string' ? body.return_url : 'https://asc-842.onrender.com/billing';
  const origin = safeOrigin(returnUrl);
  const report: Record<string, unknown> = {
    allowed_origins: (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    return_origin: origin,
    return_origin_allowed: isAllowedOrigin(origin),
  };
  try {
    const { customer, state, session, configId } = await openPortal(stripe, admin, orgId, returnUrl);
    Object.assign(report, {
      customers: state.customers.length,
      customer: maskId(customer?.customer_id),
      primary_subscription_status: state.primary?.status ?? null,
      configuration: maskId(configId),
      session_created: !!session,
    });
  } catch (e) {
    report.stripe_error = e instanceof Stripe.errors.StripeError
      ? { type: e.type, code: e.code ?? null, message: e.message }
      : String(e instanceof Error ? e.message : e);
  }
  return corsResponse(req, report);
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method !== 'POST') return corsResponse(req, { error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return corsResponse(req, { error: 'Authentication required' }, 401);
    const token = authHeader.slice('Bearer '.length);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const stripe = stripeClient();
    if (body.diagnose === true) {
      const { data: passOk } = typeof body.nonce === 'string'
        ? await admin.rpc('consume_ops_nonce', { p_nonce: body.nonce, p_purpose: 'portal-diagnose' })
        : { data: false };
      if (passOk !== true) return corsResponse(req, { error: 'Forbidden' }, 403);
      if (!stripe) return corsResponse(req, { stripe_error: 'STRIPE_SECRET_KEY is not set' }, 500);
      return await diagnose(req, admin, stripe, body);
    }

    const { data: { user }, error: getUserError } = await admin.auth.getUser(token);
    if (getUserError || !user) {
      const ipLimit = await checkRateLimit(admin, 'stripe-customer-portal', { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(corsHeaders(req), ipLimit.retryAfter);
      return corsResponse(req, { error: 'Authentication failed', code: 'AUTH_EXPIRED' }, 401);
    }

    const userLimit = await checkRateLimit(admin, 'stripe-customer-portal', { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(corsHeaders(req), userLimit.retryAfter);

    const returnUrl = typeof body.return_url === 'string' ? body.return_url : '';
    if (!isAllowedOrigin(safeOrigin(returnUrl))) {
      return corsResponse(req, { error: 'This site address is not allowed to open the billing portal.', code: 'RETURN_URL_NOT_ALLOWED' }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from('user_profiles').select('organization_id, role').eq('user_id', user.id).maybeSingle();
    if (profileError || !profile?.organization_id) {
      return corsResponse(req, { error: 'Could not determine your organization.', code: 'NO_ORGANIZATION' }, 403);
    }
    if (profile.role !== 'admin') {
      return corsResponse(req, { error: 'Only administrators can manage billing.', code: 'NOT_ADMIN' }, 403);
    }

    if (!stripe) return corsResponse(req, { error: 'Payment service unavailable', code: 'STRIPE_NOT_CONFIGURED' }, 503);

    const { session } = await openPortal(stripe, admin, profile.organization_id, returnUrl);
    if (!session) {
      return corsResponse(req, { error: 'No billing account was found for your organization. Subscribe to a plan first.', code: 'NO_CUSTOMER' }, 404);
    }
    return corsResponse(req, { url: session.url });
  } catch (error) {
    console.error('Customer portal error:', error);
    const message = error instanceof Error ? error.message : String(error);
    await logServerError(admin, 'stripe-customer-portal', message, readAlertConfig());
    const isStripe = error instanceof Stripe.errors.StripeError;
    return corsResponse(req, {
      error: isStripe ? 'Stripe could not open the billing portal.' : 'Failed to open billing portal.',
      code: isStripe ? 'PORTAL_STRIPE_ERROR' : 'PORTAL_FAILED',
    }, isStripe ? 502 : 500);
  }
});

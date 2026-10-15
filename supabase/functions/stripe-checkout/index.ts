import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, preflightResponse, isAllowedOrigin } from '../_shared/cors.ts';
import { checkRateLimit, clientIp, tooManyRequests } from '../_shared/rateLimit.ts';
import { billableSubscriptions, loadOrgStripeState } from '../_shared/stripeOrg.ts';

function corsResponse(req: Request, body: string | object | null, status = 200) {
  const ch = corsHeaders(req);
  if (status === 204) {
    return new Response(null, { status, headers: ch });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ch, 'Content-Type': 'application/json' },
  });
}

function isAllowedRedirect(url: string): boolean {
  try {
    return isAllowedOrigin(new URL(url).origin);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return preflightResponse(req);
    }

    if (req.method !== 'POST') {
      return corsResponse(req, { error: 'Method not allowed' }, 405);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return corsResponse(req, { error: 'Authentication required' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);

    if (getUserError || !user) {
      const ipLimit = await checkRateLimit(supabase, "stripe-checkout", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(corsHeaders(req), ipLimit.retryAfter);
      return corsResponse(req, { error: 'Authentication failed' }, 401);
    }

    const userLimit = await checkRateLimit(supabase, "stripe-checkout", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(corsHeaders(req), userLimit.retryAfter);

    const { price_id, success_url, cancel_url, mode } = await req.json();

    if (!price_id || typeof price_id !== 'string') {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    if (!success_url || typeof success_url !== 'string' ||
        !cancel_url || typeof cancel_url !== 'string') {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    if (mode !== 'payment' && mode !== 'subscription') {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    if (!isAllowedRedirect(success_url) || !isAllowedRedirect(cancel_url)) {
      return corsResponse(req, { error: 'Invalid redirect URL' }, 400);
    }

    if (!/^price_[A-Za-z0-9]+$/.test(price_id)) {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    const { data: customer, error: getCustomerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer:', getCustomerError);
      return corsResponse(req, { error: 'Failed to process request' }, 500);
    }

    const [monthlyRes, annualRes] = await Promise.all([
      supabase
        .from('subscription_plans')
        .select('plan_key')
        .eq('is_active', true)
        .eq('stripe_price_id_monthly', price_id)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('subscription_plans')
        .select('plan_key')
        .eq('is_active', true)
        .eq('stripe_price_id_annually', price_id)
        .limit(1)
        .maybeSingle(),
    ]);

    if (monthlyRes.error || annualRes.error || (!monthlyRes.data && !annualRes.data)) {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) {
      console.error('STRIPE_SECRET_KEY not configured');
      return corsResponse(req, { error: 'Payment service unavailable' }, 500);
    }
    const stripe = new Stripe(stripeSecret, { appInfo: { name: 'Bolt Integration', version: '1.0.0' } });

    if (mode === 'subscription') {
      const { data: profile } = await supabase
        .from('user_profiles').select('organization_id').eq('user_id', user.id).maybeSingle();
      if (!profile?.organization_id) return corsResponse(req, { error: 'Could not determine your organization.' }, 403);
      const state = await loadOrgStripeState(stripe, supabase, profile.organization_id);
      if (billableSubscriptions(state).length > 0) {
        return corsResponse(req, {
          error: 'Your organization already has a subscription. Use "Switch to" on the Billing page to change plans.',
          code: 'SUBSCRIPTION_EXISTS',
        }, 409);
      }
    }

    let customerId: string;

    if (!customer || !customer.customer_id) {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });

      const { error: createCustomerError } = await supabase.from('stripe_customers').insert({
        user_id: user.id,
        customer_id: newCustomer.id,
      });

      if (createCustomerError) {
        console.error('Failed to save customer:', createCustomerError);
        try { await stripe.customers.del(newCustomer.id); } catch (cleanupErr) { console.error('Customer cleanup failed:', cleanupErr); }
        return corsResponse(req, { error: 'Failed to set up payment account' }, 500);
      }

      if (mode === 'subscription') {
        const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
          customer_id: newCustomer.id,
          status: 'not_started',
        });

        if (createSubscriptionError) {
          console.error('Failed to create subscription record:', createSubscriptionError);
          try { await stripe.customers.del(newCustomer.id); } catch (cleanupErr) { console.error('Customer cleanup failed:', cleanupErr); }
          return corsResponse(req, { error: 'Failed to set up subscription' }, 500);
        }
      }

      customerId = newCustomer.id;
    } else {
      customerId = customer.customer_id;

      if (mode === 'subscription') {
        const { data: subscription, error: getSubscriptionError } = await supabase
          .from('stripe_subscriptions')
          .select('status')
          .eq('customer_id', customerId)
          .maybeSingle();

        if (getSubscriptionError) {
          console.error('Failed to fetch subscription:', getSubscriptionError);
          return corsResponse(req, { error: 'Failed to process request' }, 500);
        }

        if (!subscription) {
          const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
            customer_id: customerId,
            status: 'not_started',
          });

          if (createSubscriptionError) {
            console.error('Failed to create subscription record:', createSubscriptionError);
            return corsResponse(req, { error: 'Failed to set up subscription' }, 500);
          }
        }
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      mode,
      success_url,
      cancel_url,
    });

    return corsResponse(req, { sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return corsResponse(req, { error: 'An unexpected error occurred' }, 500);
  }
});

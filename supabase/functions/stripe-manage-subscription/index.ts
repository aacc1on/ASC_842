import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, preflightResponse } from '../_shared/cors.ts';
import { checkRateLimit, clientIp, tooManyRequests } from '../_shared/rateLimit.ts';
import { logServerError, readAlertConfig } from '../_shared/alerts.ts';

function corsResponse(req: Request, body: string | object | null, status = 200) {
  const ch = corsHeaders(req);
  if (status === 204) return new Response(null, { status, headers: ch });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ch, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method !== 'POST') return corsResponse(req, { error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return corsResponse(req, { error: 'Authentication required' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);
    if (getUserError || !user) {
      const ipLimit = await checkRateLimit(supabase, 'stripe-manage-subscription', { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(corsHeaders(req), ipLimit.retryAfter);
      return corsResponse(req, { error: 'Authentication failed' }, 401);
    }

    const userLimit = await checkRateLimit(supabase, 'stripe-manage-subscription', { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(corsHeaders(req), userLimit.retryAfter);

    const { action } = await req.json();
    if (action !== 'cancel' && action !== 'resume') {
      return corsResponse(req, { error: 'Invalid action. Use "cancel" or "resume".' }, 400);
    }

    // Verify the caller is an admin of the org that owns the Stripe subscription.
    // Never trust an org_id from the client — resolve it from the authenticated user.
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      return corsResponse(req, { error: 'Could not determine your organization.' }, 403);
    }

    if (profile.role !== 'admin') {
      return corsResponse(req, { error: 'Only administrators can manage the subscription.' }, 403);
    }

    // Find the Stripe customer for this org (through any user in the org).
    const { data: customerRow, error: custError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .in('user_id', (
        await supabase
          .from('user_profiles')
          .select('user_id')
          .eq('organization_id', profile.organization_id)
        ).data?.map((u: { user_id: string }) => u.user_id) ?? [])
      .is('deleted_at', null)
      .maybeSingle();

    if (custError || !customerRow?.customer_id) {
      return corsResponse(req, { error: 'No Stripe customer found for your organization.' }, 404);
    }

    const customerId = customerRow.customer_id;

    // Find the active Stripe subscription for this customer.
    const { data: subRow, error: subError } = await supabase
      .from('stripe_subscriptions')
      .select('subscription_id, status')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (subError || !subRow?.subscription_id) {
      return corsResponse(req, { error: 'No active Stripe subscription found.' }, 404);
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) return corsResponse(req, { error: 'Payment service unavailable' }, 500);
    const stripe = new Stripe(stripeSecret, { appInfo: { name: 'Bolt Integration', version: '1.0.0' } });

    const cancelAtPeriodEnd = action === 'cancel';

    const updated = await stripe.subscriptions.update(subRow.subscription_id, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });

    // Update our local record so the UI reflects the change before the webhook arrives.
    await supabase
      .from('stripe_subscriptions')
      .update({ cancel_at_period_end: cancelAtPeriodEnd, updated_at: new Date().toISOString() })
      .eq('subscription_id', subRow.subscription_id);

    // Write an audit_log entry.
    await supabase.from('audit_log').insert({
      organization_id: profile.organization_id,
      actor_user_id: user.id,
      table_name: 'subscriptions',
      record_id: subRow.subscription_id,
      action: action === 'cancel' ? 'cancel_subscription' : 'resume_subscription',
      new_data: { cancel_at_period_end: cancelAtPeriodEnd, current_period_end: updated.current_period_end },
    });

    const periodEnd = new Date(updated.current_period_end * 1000).toISOString();

    return corsResponse(req, {
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: periodEnd,
    });
  } catch (error) {
    console.error('Manage subscription error:', error);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await logServerError(supabase, 'stripe-manage-subscription', error instanceof Error ? error.message : String(error), readAlertConfig());
    return corsResponse(req, { error: 'An unexpected error occurred' }, 500);
  }
});

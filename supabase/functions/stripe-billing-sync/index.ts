import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, preflightResponse } from '../_shared/cors.ts';
import { logServerError, readAlertConfig } from '../_shared/alerts.ts';
import { checkRateLimit, tooManyRequests } from '../_shared/rateLimit.ts';
import { planForPrice } from '../_shared/billingRules.ts';
import { loadOrgStripeState, loadPlans, stripeClient, syncOrgFromStripe } from '../_shared/stripeOrg.ts';

function corsResponse(req: Request, body: string | object | null, status = 200) {
  const ch = corsHeaders(req);
  if (status === 204) return new Response(null, { status, headers: ch });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ch, 'Content-Type': 'application/json' },
  });
}

const INVOICE_STATUS: Record<string, string> = {
  paid: 'paid', open: 'open', uncollectible: 'uncollectible', void: 'void', draft: 'open',
};

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
    if (getUserError || !user) return corsResponse(req, { error: 'Authentication failed' }, 401);

    const limit = await checkRateLimit(supabase, 'stripe-billing-sync', { userId: user.id });
    if (!limit.allowed) return tooManyRequests(corsHeaders(req), limit.retryAfter);

    // Resolve the user's org.
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      return corsResponse(req, { error: 'Could not determine your organization.' }, 403);
    }

    const orgId = profile.organization_id;
    const stripe = stripeClient();
    if (!stripe) return corsResponse(req, { error: 'Payment service unavailable' }, 500);

    const state = await loadOrgStripeState(stripe, supabase, orgId);
    if (state.customers.length === 0) return corsResponse(req, { synced: false, reason: 'no_stripe_customer' });

    const plans = await loadPlans(supabase);
    for (const [customerId, subs] of state.byCustomer) {
      for (const sub of subs) {
        const match = planForPrice(plans, sub.items.data[0]?.price?.id);
        const invoices = await stripe.invoices.list({ customer: customerId, subscription: sub.id, limit: 50 });
        for (const invoice of invoices.data) {
          if (!invoice.id) continue;
          // Line periods are the real billing period; invoice-level periods are zero-length on a first invoice.
          const line = invoice.lines?.data?.[0];
          const start = line?.period?.start ?? invoice.period_start ?? null;
          const end = line?.period?.end ?? invoice.period_end ?? null;
          const { error } = await supabase.from('stripe_invoices').upsert({
            organization_id: orgId,
            stripe_invoice_id: invoice.id,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            amount_due: invoice.amount_due ?? 0,
            amount_paid: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? 'usd',
            status: INVOICE_STATUS[invoice.status ?? 'open'] ?? 'open',
            plan_key: match?.plan.plan_key ?? null,
            billing_cycle: match?.cycle ?? null,
            period_start: start ? new Date(start * 1000).toISOString() : null,
            period_end: end ? new Date(end * 1000).toISOString() : null,
            invoice_date: new Date((invoice.created ?? Date.now() / 1000) * 1000).toISOString(),
            hosted_invoice_url: invoice.hosted_invoice_url ?? null,
            invoice_pdf_url: invoice.invoice_pdf ?? null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'stripe_invoice_id' });
          if (error) throw new Error(`Failed to save invoice: ${error.message}`);
        }
      }
    }

    const { synced, planKey } = await syncOrgFromStripe(stripe, supabase, orgId, state);
    return corsResponse(req, { synced, plan_key: planKey });
  } catch (error) {
    console.error('Billing sync error:', error);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await logServerError(supabase, 'stripe-billing-sync', error instanceof Error ? error.message : String(error), readAlertConfig());
    return corsResponse(req, { error: 'An unexpected error occurred' }, 500);
  }
});

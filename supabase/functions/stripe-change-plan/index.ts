import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, preflightResponse } from '../_shared/cors.ts';
import { checkRateLimit, clientIp, tooManyRequests } from '../_shared/rateLimit.ts';
import { logServerError, readAlertConfig } from '../_shared/alerts.ts';
import { planForPrice, planLimitBlockers, priceForPlan, type BillingCycle } from '../_shared/billingRules.ts';
import { loadOrgStripeState, loadPlans, orgUsage, stripeClient, syncOrgFromStripe } from '../_shared/stripeOrg.ts';

function corsResponse(req: Request, body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

const PRORATION_WINDOW_SECONDS = 15 * 60;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method !== 'POST') return corsResponse(req, { error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return corsResponse(req, { error: 'Authentication required' }, 401);

    const { data: { user }, error: getUserError } = await admin.auth.getUser(authHeader.slice('Bearer '.length));
    if (getUserError || !user) {
      const ipLimit = await checkRateLimit(admin, 'stripe-change-plan', { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(corsHeaders(req), ipLimit.retryAfter);
      return corsResponse(req, { error: 'Authentication failed', code: 'AUTH_EXPIRED' }, 401);
    }
    const userLimit = await checkRateLimit(admin, 'stripe-change-plan', { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(corsHeaders(req), userLimit.retryAfter);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action;
    const cycle = body.billing_cycle as BillingCycle;
    if ((action !== 'preview' && action !== 'confirm') || typeof body.plan_key !== 'string' || (cycle !== 'monthly' && cycle !== 'annually')) {
      return corsResponse(req, { error: 'Invalid request' }, 400);
    }

    const { data: profile } = await admin
      .from('user_profiles').select('organization_id, role').eq('user_id', user.id).maybeSingle();
    if (!profile?.organization_id) return corsResponse(req, { error: 'Could not determine your organization.' }, 403);
    if (profile.role !== 'admin') return corsResponse(req, { error: 'Only administrators can change the plan.', code: 'NOT_ADMIN' }, 403);
    const orgId: string = profile.organization_id;

    const plans = await loadPlans(admin);
    const target = plans.find((p) => p.plan_key === body.plan_key);
    const targetPrice = target ? priceForPlan(target, cycle) : null;
    if (!target || !targetPrice) return corsResponse(req, { error: 'That plan is not available.', code: 'PLAN_UNAVAILABLE' }, 400);

    const stripe = stripeClient();
    if (!stripe) return corsResponse(req, { error: 'Payment service unavailable' }, 503);

    const state = await loadOrgStripeState(stripe, admin, orgId);
    const sub = state.primary;
    if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) {
      return corsResponse(req, { error: 'There is no active subscription to change. Subscribe to a plan first.', code: 'NO_ACTIVE_SUBSCRIPTION' }, 409);
    }
    if (sub.cancel_at_period_end) {
      return corsResponse(req, { error: 'Your subscription is set to cancel. Resume it before switching plans.', code: 'SUBSCRIPTION_CANCELLING' }, 409);
    }
    const item = sub.items.data[0];
    if (!item || sub.items.data.length !== 1) {
      return corsResponse(req, { error: 'This subscription cannot be changed here. Please contact support.', code: 'UNSUPPORTED_SUBSCRIPTION' }, 409);
    }
    if (item.price.id === targetPrice) {
      return corsResponse(req, { error: 'You are already on this plan.', code: 'SAME_PLAN' }, 409);
    }

    const blockers = planLimitBlockers(await orgUsage(admin, orgId), target);
    if (blockers.length > 0) {
      return corsResponse(req, { error: blockers.join(' '), code: 'PLAN_LIMIT_EXCEEDED', reasons: blockers }, 409);
    }

    const now = Math.floor(Date.now() / 1000);
    const requested = Number(body.proration_date);
    const prorationDate = Number.isInteger(requested) && requested <= now && now - requested <= PRORATION_WINDOW_SECONDS ? requested : now;
    const items = [{ id: item.id, price: targetPrice }];

    if (action === 'preview') {
      const preview = await stripe.invoices.createPreview({
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscription: sub.id,
        subscription_details: { items, proration_behavior: 'always_invoice', proration_date: prorationDate },
      });
      return corsResponse(req, {
        plan_key: target.plan_key,
        plan_name: target.plan_name,
        billing_cycle: cycle,
        amount_due: preview.amount_due,
        total: preview.total,
        currency: preview.currency,
        proration_date: prorationDate,
        lines: preview.lines.data.slice(0, 10).map((l) => ({ description: l.description, amount: l.amount })),
      });
    }

    const previous = planForPrice(plans, item.price.id);
    const updated = await stripe.subscriptions.update(sub.id, {
      items,
      proration_behavior: 'always_invoice',
      proration_date: prorationDate,
      payment_behavior: 'pending_if_incomplete',
    });
    if (updated.pending_update) {
      return corsResponse(req, {
        error: 'The payment for this change did not go through, so your plan was not changed. Update your payment method in Manage billing and try again.',
        code: 'PAYMENT_REQUIRED',
      }, 402);
    }

    await syncOrgFromStripe(stripe, admin, orgId);
    await admin.from('audit_log').insert({
      organization_id: orgId,
      actor_user_id: user.id,
      table_name: 'subscriptions',
      record_id: sub.id,
      action: 'change_plan',
      old_data: { plan_key: previous?.plan.plan_key ?? null, billing_cycle: previous?.cycle ?? null },
      new_data: { plan_key: target.plan_key, billing_cycle: cycle },
    });

    return corsResponse(req, { changed: true, plan_key: target.plan_key, plan_name: target.plan_name, billing_cycle: cycle });
  } catch (error) {
    console.error('Change plan error:', error);
    await logServerError(admin, 'stripe-change-plan', error instanceof Error ? error.message : String(error), readAlertConfig());
    if (error instanceof Stripe.errors.StripeCardError) {
      return corsResponse(req, { error: 'Your card was declined, so the plan was not changed.', code: 'PAYMENT_REQUIRED' }, 402);
    }
    return corsResponse(req, { error: 'Failed to change plan. Please try again.', code: 'CHANGE_PLAN_FAILED' }, 500);
  }
});

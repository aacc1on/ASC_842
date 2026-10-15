import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { logServerError, readAlertConfig } from '../_shared/alerts.ts';
import { planForPrice } from '../_shared/billingRules.ts';
import { loadPlans, orgIdForCustomer, syncOrgFromStripe } from '../_shared/stripeOrg.ts';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: { name: 'Bolt Integration', version: '1.0.0' },
});

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return new Response('Missing signature', { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, stripeWebhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Webhook signature verification failed: ${message}`);
      return new Response('Webhook signature verification failed', { status: 400 });
    }

    // SEC-004: Process the event BEFORE replying so Stripe can retry on failure.
    // Claim the event id FIRST: a read-then-write check lets two concurrent
    // redeliveries of the same event both pass and process it twice. The
    // primary key on stripe_processed_events makes this claim atomic.
    const { error: claimError } = await supabase
      .from('stripe_processed_events')
      .insert({ event_id: event.id, event_type: event.type });

    if (claimError) {
      // 23505 = unique violation: another invocation already claimed this event.
      if (claimError.code === '23505') {
        console.info(`Event ${event.id} already processed, skipping`);
        return Response.json({ received: true });
      }
      console.error(`Failed to claim event ${event.id}:`, claimError);
      await reportWebhookError(`Failed to claim event ${event.type}: ${claimError.message}`);
      return Response.json({ error: 'Failed to process event' }, { status: 500 });
    }

    try {
      await handleEvent(event);

      return Response.json({ received: true });
    } catch (processError) {
      console.error(`Failed to process event ${event.id}:`, processError);
      // Release the claim so Stripe's retry is able to process the event.
      await supabase.from('stripe_processed_events').delete().eq('event_id', event.id);
      await reportWebhookError(`Failed to process event ${event.type}: ${errorText(processError)}`);
      return Response.json({ error: 'Failed to process event' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in webhook handler:', error);
    await reportWebhookError(`Webhook handler error: ${errorText(error)}`);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
});

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function reportWebhookError(message: string): Promise<void> {
  return logServerError(supabase, 'stripe_webhook', `stripe-webhook: ${message}`, readAlertConfig());
}

async function handleEvent(event: Stripe.Event) {
  const stripeData = event?.data?.object ?? {};

  // Invoice events — record payment history.
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' || event.type === 'invoice.finalized') {
    await recordInvoice(stripeData as Stripe.Invoice);
    // Also sync the subscription so our local data stays current.
    const invoice = stripeData as Stripe.Invoice;
    if (invoice.customer && typeof invoice.customer === 'string') {
      await syncCustomerFromStripe(invoice.customer);
    }
    return;
  }

  // Subscription events — keep our local data in sync.
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = stripeData as Stripe.Subscription;
    if (sub.customer && typeof sub.customer === 'string') {
      await syncCustomerFromStripe(sub.customer);
    }
    return;
  }

  if (!stripeData || !('customer' in stripeData)) {
    return;
  }

  if (event.type === 'payment_intent.succeeded' && event.data.object.invoice === null) {
    return;
  }

  const { customer: customerId } = stripeData;
  if (!customerId || typeof customerId !== 'string') {
    console.error(`No customer received on event: ${event.id}`);
    return;
  }

  let isSubscription = true;

  if (event.type === 'checkout.session.completed') {
    const { mode } = stripeData as Stripe.Checkout.Session;
    isSubscription = mode === 'subscription';
  }

  const { mode, payment_status } = stripeData as Stripe.Checkout.Session;

  if (isSubscription) {
    await syncCustomerFromStripe(customerId);
  } else if (mode === 'payment' && payment_status === 'paid') {
    const {
      id: checkout_session_id,
      payment_intent,
      amount_subtotal,
      amount_total,
      currency,
    } = stripeData as Stripe.Checkout.Session;

    const { error: orderError } = await supabase.from('stripe_orders').insert({
      checkout_session_id,
      payment_intent_id: payment_intent,
      customer_id: customerId,
      amount_subtotal,
      amount_total,
      currency,
      payment_status,
      status: 'completed',
    });

    if (orderError) {
      console.error('Error inserting order:', orderError);
      throw new Error('Failed to insert order');
    }
  }
}

async function recordInvoice(invoice: Stripe.Invoice) {
  if (!invoice.id || !invoice.customer || typeof invoice.customer !== 'string') return;

  // Resolve the org from the Stripe customer.
  const { data: stripeCustomer, error: custError } = await supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('customer_id', invoice.customer)
    .is('deleted_at', null)
    .maybeSingle();

  if (custError || !stripeCustomer?.user_id) {
    console.error(`Could not find user for Stripe customer: ${invoice.customer}`);
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('user_id', stripeCustomer.user_id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    console.error(`Could not find organization for user: ${stripeCustomer.user_id}`);
    return;
  }

  let planKey: string | null = null;
  let billingCycle: string | null = null;
  const line = invoice.lines?.data?.find((l) => l.price?.id) ?? invoice.lines?.data?.[0];
  const match = planForPrice(await loadPlans(supabase), line?.price?.id);
  if (match) {
    planKey = match.plan.plan_key;
    billingCycle = match.cycle;
  }

  const statusMap: Record<string, string> = {
    paid: 'paid',
    open: 'open',
    uncollectible: 'uncollectible',
    void: 'void',
    draft: 'open',
  };
  const mappedStatus = statusMap[invoice.status ?? 'open'] ?? 'open';
  // Line periods are the real billing period; invoice-level periods are zero-length on a first invoice.
  const periodStart = line?.period?.start ?? invoice.period_start ?? null;
  const periodEnd = line?.period?.end ?? invoice.period_end ?? null;

  const { error: invoiceError } = await supabase
    .from('stripe_invoices')
    .upsert({
      organization_id: profile.organization_id,
      stripe_invoice_id: invoice.id,
      stripe_customer_id: invoice.customer,
      stripe_subscription_id: invoice.subscription && typeof invoice.subscription === 'string' ? invoice.subscription : null,
      amount_due: invoice.amount_due ?? 0,
      amount_paid: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? 'usd',
      status: mappedStatus,
      plan_key: planKey,
      billing_cycle: billingCycle,
      period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      invoice_date: invoice.created ? new Date(invoice.created * 1000).toISOString() : new Date().toISOString(),
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf_url: invoice.invoice_pdf ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stripe_invoice_id' });
  if (invoiceError) throw new Error(`Failed to record invoice: ${invoiceError.message}`);
}

async function syncCustomerFromStripe(customerId: string) {
  const orgId = await orgIdForCustomer(supabase, customerId);
  if (!orgId) {
    console.error('Could not find organization for Stripe customer');
    return;
  }
  await syncOrgFromStripe(stripe, supabase, orgId);
}

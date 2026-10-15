/*
# Billing: invoice records, cancel/resume support, and renewal disclosure

## Purpose
The approved Terms (version 2026-10-14) promise that users may cancel at any time
in the app and that cancellation takes effect at the end of the current paid term.
California's Automatic Renewal Law requires clear renewal terms and an easy online
cancellation. This migration adds the database infrastructure for:
1. Real invoice/payment history recorded from Stripe webhook events.
2. Cancel/resume subscription support (cancel_at_period_end on Stripe).
3. Stripe Customer Portal integration (manage billing, update card, download invoices).
4. Honest display for orgs without Stripe (trial, or plan set manually by the platform owner).

## New Tables

### `stripe_invoices`
Records each Stripe invoice for an organization.
- `id` (bigserial PK)
- `organization_id` (uuid, NOT NULL, defaults to internal.current_org_id(), FK to organizations)
- `stripe_invoice_id` (text, unique, NOT NULL) — Stripe invoice ID (e.g. in_...)
- `stripe_customer_id` (text, NOT NULL) — Stripe customer ID
- `stripe_subscription_id` (text, nullable) — Stripe subscription ID if from a subscription
- `amount_due` (bigint, NOT NULL default 0) — amount in cents
- `amount_paid` (bigint, NOT NULL default 0) — amount paid in cents
- `currency` (text, NOT NULL default 'usd')
- `status` (text, NOT NULL default 'open') — paid, open, uncollectible, void
- `plan_key` (text, nullable) — derived from the subscription price at invoice time
- `billing_cycle` (text, nullable) — monthly or annually
- `period_start` (timestamptz, nullable) — invoice period start
- `period_end` (timestamptz, nullable) — invoice period end
- `invoice_date` (timestamptz, NOT NULL default now()) — when the invoice was created
- `hosted_invoice_url` (text, nullable) — Stripe hosted invoice page URL
- `invoice_pdf_url` (text, nullable) — Stripe invoice PDF URL
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

### `stripe_org_subscriptions` (view)
Exposes the Stripe subscription for the current user's organization, joined through
stripe_customers → user_profiles → organizations. Returns one row with:
customer_id, subscription_id, subscription_status, price_id, cancel_at_period_end,
current_period_start, current_period_end, payment_method_brand, payment_method_last4,
and the internal subscriptions row (plan_key, billing_cycle, status, trial_ends_at,
current_period_end as internal_period_end).

## Modified Tables
- `stripe_subscriptions`: no schema changes needed (cancel_at_period_end already exists).

## Security
- `stripe_invoices`: RLS enabled.
  - SELECT for authenticated org members (organization_id = internal.current_org_id()).
  - Platform admin can read all (internal.is_platform_admin()).
  - No INSERT/UPDATE/DELETE policies for authenticated — only the service role (edge
    functions using SUPABASE_SERVICE_ROLE_KEY) writes to this table.
- `stripe_org_subscriptions` view: scoped to the current user's org via auth.uid() join.

## Important Notes
1. The `stripe_invoices` table gets the `a00_set_organization_id` trigger and the
   `internal.current_org_id()` default on `organization_id`, consistent with all
   org-scoped tables created after migration 20261011024747.
2. The webhook (service role) inserts invoice rows; RLS is bypassed for the service role.
3. Backfill is done by the edge function at deploy time (fetching existing invoices from
   Stripe for current customers), not in this migration, because we cannot call the Stripe
   API from a SQL migration.
4. Idempotency: stripe_invoices.stripe_invoice_id has a UNIQUE constraint, so re-processing
   a webhook event uses upsert (ON CONFLICT DO UPDATE).
5. The `stripe_org_subscriptions` view replaces the old `stripe_user_subscriptions` view
   which was user-scoped. The new view is org-scoped so any org admin can see the
   subscription, not just the user who created the Stripe customer.
*/

-- ---------------------------------------------------------------------------
-- 1. stripe_invoices table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_invoices (
  id BIGSERIAL PRIMARY KEY,
  organization_id uuid NOT NULL DEFAULT internal.current_org_id() REFERENCES public.organizations(id) ON DELETE RESTRICT,
  stripe_invoice_id text NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text,
  amount_due bigint NOT NULL DEFAULT 0,
  amount_paid bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'open',
  plan_key text REFERENCES public.subscription_plans(plan_key),
  billing_cycle text,
  period_start timestamptz,
  period_end timestamptz,
  invoice_date timestamptz NOT NULL DEFAULT now(),
  hosted_invoice_url text,
  invoice_pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_invoices_stripe_id
  ON public.stripe_invoices (stripe_invoice_id);

CREATE INDEX IF NOT EXISTS idx_stripe_invoices_org
  ON public.stripe_invoices (organization_id, invoice_date DESC);

ALTER TABLE public.stripe_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_org_invoices" ON public.stripe_invoices;
CREATE POLICY "select_org_invoices" ON public.stripe_invoices FOR SELECT
  TO authenticated
  USING (organization_id = internal.current_org_id() OR internal.is_platform_admin());

-- No INSERT/UPDATE/DELETE policies: only the service role (edge functions) writes.

-- ---------------------------------------------------------------------------
-- 2. a00_set_organization_id trigger on stripe_invoices
-- ---------------------------------------------------------------------------
CREATE TRIGGER a00_set_organization_id
  BEFORE INSERT OR UPDATE ON public.stripe_invoices
  FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- ---------------------------------------------------------------------------
-- 3. stripe_org_subscriptions view (org-scoped, replaces stripe_user_subscriptions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stripe_org_subscriptions AS
SELECT
  sc.customer_id,
  ss.subscription_id,
  ss.status        AS subscription_status,
  ss.price_id,
  ss.current_period_start,
  ss.current_period_end,
  ss.cancel_at_period_end,
  ss.payment_method_brand,
  ss.payment_method_last4,
  s.plan_key,
  s.billing_cycle,
  s.status        AS internal_status,
  s.trial_ends_at,
  s.current_period_end AS internal_period_end
FROM public.stripe_customers sc
JOIN public.stripe_subscriptions ss ON ss.customer_id = sc.customer_id
LEFT JOIN public.user_profiles up ON up.user_id = sc.user_id
LEFT JOIN public.subscriptions s ON s.organization_id = up.organization_id
WHERE sc.deleted_at IS NULL
  AND ss.deleted_at IS NULL
  AND up.organization_id = internal.current_org_id();

GRANT SELECT ON public.stripe_org_subscriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. stripe_org_invoices view (org-scoped invoice list for the frontend)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stripe_org_invoices AS
SELECT
  si.id,
  si.organization_id,
  si.stripe_invoice_id,
  si.stripe_customer_id,
  si.stripe_subscription_id,
  si.amount_due,
  si.amount_paid,
  si.currency,
  si.status,
  si.plan_key,
  si.billing_cycle,
  si.period_start,
  si.period_end,
  si.invoice_date,
  si.hosted_invoice_url,
  si.invoice_pdf_url
FROM public.stripe_invoices si
WHERE si.organization_id = internal.current_org_id()
ORDER BY si.invoice_date DESC;

GRANT SELECT ON public.stripe_org_invoices TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Add cancel_at_period_end awareness to org_plan_key
--    When cancel_at_period_end is true and the period hasn't ended, the plan
--    stays active (the org can still use the product until the period ends).
--    The existing logic already handles this: status='active' and period_end > now()
--    returns the plan_key. When the period ends, the webhook sets status='cancelled'
--    and org_plan_key returns 'expired'. No function change needed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Audit log helper for billing actions (cancel/resume)
--    The edge function uses the service role to insert audit_log entries.
--    No new function needed — the service role bypasses RLS.
-- ---------------------------------------------------------------------------

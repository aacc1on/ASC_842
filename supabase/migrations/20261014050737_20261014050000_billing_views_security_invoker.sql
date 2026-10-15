-- Switch billing views from SECURITY DEFINER (default) to SECURITY INVOKER.
-- The underlying tables (stripe_customers, stripe_subscriptions, user_profiles,
-- stripe_invoices) all have RLS enabled with org-scoped policies, so the views
-- are safe as INVOKER — the caller's RLS context filters rows correctly.

ALTER VIEW public.stripe_org_subscriptions SET (security_invoker = true);
ALTER VIEW public.stripe_org_invoices SET (security_invoker = true);

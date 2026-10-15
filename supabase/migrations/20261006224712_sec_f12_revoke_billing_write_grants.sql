/*
# F12 - Remove unused write privileges on billing and configuration tables

1. Problem
   The `authenticated` role held INSERT, UPDATE and DELETE on the billing and
   configuration relations (`subscription_plans`, `organizations`,
   `subscriptions`, `stripe_customers`, `stripe_orders`,
   `stripe_subscriptions`, `stripe_processed_events` and the two stripe views),
   even though each of those relations only has a SELECT policy. Row level
   security denies the writes today, so nothing is exploitable, but the grants
   mean a single over-broad policy added later would immediately let any
   signed-in user rewrite plan pricing or their own subscription status.

2. Changes
   - Revoke INSERT, UPDATE, DELETE on those relations from `authenticated`
     (and from `anon`, which should hold nothing). SELECT is untouched, so
     every read the app performs keeps working. All writes to these tables are
     made by the checkout and webhook functions under the service role, which
     is unaffected by grants.

3. Security
   - Defence in depth: the browser-facing roles can no longer write billing
     data even if a policy is widened by mistake.
*/

DO $$
DECLARE
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'public.subscription_plans',
    'public.organizations',
    'public.subscriptions',
    'public.stripe_customers',
    'public.stripe_orders',
    'public.stripe_subscriptions',
    'public.stripe_processed_events',
    'public.stripe_user_orders',
    'public.stripe_user_subscriptions'
  ]
  LOOP
    IF to_regclass(rel) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %s FROM authenticated', rel);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %s FROM anon', rel);
    END IF;
  END LOOP;
END $$;

-- Fix stripe_user_subscriptions and stripe_user_orders views to use INNER JOIN
-- so they never return rows with all-null stripe data (which crashes the UI).

CREATE OR REPLACE VIEW stripe_user_subscriptions WITH (security_invoker = true) AS
SELECT
    c.customer_id,
    s.subscription_id,
    s.status AS subscription_status,
    s.price_id,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.payment_method_brand,
    s.payment_method_last4
FROM stripe_customers c
INNER JOIN stripe_subscriptions s ON c.customer_id = s.customer_id
WHERE c.user_id = auth.uid()
  AND c.deleted_at IS NULL
  AND s.deleted_at IS NULL;

GRANT SELECT ON stripe_user_subscriptions TO authenticated;

CREATE OR REPLACE VIEW stripe_user_orders WITH (security_invoker = true) AS
SELECT
    c.customer_id,
    o.id AS order_id,
    o.checkout_session_id,
    o.payment_intent_id,
    o.amount_subtotal,
    o.amount_total,
    o.currency,
    o.payment_status,
    o.status AS order_status,
    o.created_at AS order_date
FROM stripe_customers c
INNER JOIN stripe_orders o ON c.customer_id = o.customer_id
WHERE c.user_id = auth.uid()
  AND c.deleted_at IS NULL
  AND o.deleted_at IS NULL;

GRANT SELECT ON stripe_user_orders TO authenticated;

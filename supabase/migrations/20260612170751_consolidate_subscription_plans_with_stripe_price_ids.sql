-- Ensure stripe_price_id columns exist (idempotent)
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annually text DEFAULT NULL;

-- Upsert plans with price IDs so a fresh DB has everything in one shot
INSERT INTO subscription_plans (plan_key, plan_name, max_leases, price_monthly, price_annually, features, sort_order, stripe_price_id_monthly, stripe_price_id_annually)
VALUES
  ('starter',      'Starter',      50,  200.00, 2040.00, '["Up to 50 active leases","ASC 842 Compliance","Amortization schedules","Journal entries"]',          1, 'price_1ThY3wJEJHJ1jQ36qiVrlhYp', 'price_1ThYLiJEJHJ1jQ36Dt7rdCaK'),
  ('professional', 'Professional', 100, 300.00, 3060.00, '["Up to 100 active leases","Everything in Starter","Contract modifications","Branch management"]',    2, 'price_1ThYEiJEJHJ1jQ36MayNgN41', 'price_1ThYLHJEJHJ1jQ36h6pPH5gL'),
  ('enterprise',   'Enterprise',   200, 500.00, 5100.00, '["Up to 200 active leases","Everything in Pro","Multi-user & team roles","Dedicated support"]',        3, 'price_1ThYH5JEJHJ1jQ36giYJPmIU', 'price_1ThYKbJEJHJ1jQ36NhZTdeFx')
ON CONFLICT (plan_key) DO UPDATE SET
  stripe_price_id_monthly = EXCLUDED.stripe_price_id_monthly,
  stripe_price_id_annually = EXCLUDED.stripe_price_id_annually;

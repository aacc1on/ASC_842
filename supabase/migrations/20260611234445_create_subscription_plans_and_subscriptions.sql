-- Subscription plans reference table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text UNIQUE NOT NULL,
  plan_name text NOT NULL,
  max_leases integer NOT NULL,
  price_monthly numeric(10,2) NOT NULL,
  price_annually numeric(10,2) NOT NULL,
  features jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO subscription_plans (plan_key, plan_name, max_leases, price_monthly, price_annually, features, sort_order)
VALUES
  ('starter',      'Starter',      50,  200.00, 2040.00, '["Up to 50 active leases","ASC 842 Compliance","Amortization schedules","Journal entries"]', 1),
  ('professional', 'Professional', 100, 300.00, 3060.00, '["Up to 100 active leases","Everything in Starter","Contract modifications","Branch management"]', 2),
  ('enterprise',   'Enterprise',   200, 500.00, 5100.00, '["Up to 200 active leases","Everything in Pro","Multi-user & team roles","Dedicated support"]', 3)
ON CONFLICT (plan_key) DO NOTHING;

-- User subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_key text NOT NULL REFERENCES subscription_plans(plan_key),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annually')),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz DEFAULT (now() + interval '1 month'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_subscription" ON subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_subscription" ON subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_subscription" ON subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_subscription" ON subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Plans are public
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_public_read" ON subscription_plans FOR SELECT
  TO anon, authenticated USING (true);

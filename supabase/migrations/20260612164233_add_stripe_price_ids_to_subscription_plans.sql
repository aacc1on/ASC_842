ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annually text DEFAULT NULL;

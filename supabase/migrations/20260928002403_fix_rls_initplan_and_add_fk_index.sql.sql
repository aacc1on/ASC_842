/*
# Fix RLS initplan: replace bare auth.uid() with (SELECT auth.uid()) wrapper

Replaces bare `auth.uid()` calls with `(SELECT auth.uid())` in RLS policies
on 7 tables to prevent per-row re-evaluation (auth_rls_initplan warnings).
Also adds missing FK index on subscriptions.plan_key.
*/

-- 1. user_profiles: "Admins can delete profiles"
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;
CREATE POLICY "Admins can delete profiles" ON user_profiles
  FOR DELETE TO authenticated
  USING (internal.is_admin() AND (user_id <> (SELECT auth.uid())));

-- 2. fixed_asset_types: 4 ownership policies
DROP POLICY IF EXISTS "Users can select own fixed_asset_types" ON fixed_asset_types;
CREATE POLICY "Users can select own fixed_asset_types" ON fixed_asset_types
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own fixed_asset_types" ON fixed_asset_types;
CREATE POLICY "Users can insert own fixed_asset_types" ON fixed_asset_types
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own fixed_asset_types" ON fixed_asset_types;
CREATE POLICY "Users can update own fixed_asset_types" ON fixed_asset_types
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own fixed_asset_types" ON fixed_asset_types;
CREATE POLICY "Users can delete own fixed_asset_types" ON fixed_asset_types
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 3. companies: 4 ownership policies
DROP POLICY IF EXISTS "select_own_companies" ON companies;
CREATE POLICY "select_own_companies" ON companies
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "insert_own_companies" ON companies;
CREATE POLICY "insert_own_companies" ON companies
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "update_own_companies" ON companies;
CREATE POLICY "update_own_companies" ON companies
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "delete_own_companies" ON companies;
CREATE POLICY "delete_own_companies" ON companies
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 4. subscriptions: 4 ownership policies
DROP POLICY IF EXISTS "select_own_subscription" ON subscriptions;
CREATE POLICY "select_own_subscription" ON subscriptions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "insert_own_subscription" ON subscriptions;
CREATE POLICY "insert_own_subscription" ON subscriptions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "update_own_subscription" ON subscriptions;
CREATE POLICY "update_own_subscription" ON subscriptions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "delete_own_subscription" ON subscriptions;
CREATE POLICY "delete_own_subscription" ON subscriptions
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 5. stripe_customers: select policy
DROP POLICY IF EXISTS "Users can view their own customer data" ON stripe_customers;
CREATE POLICY "Users can view their own customer data" ON stripe_customers
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) AND (deleted_at IS NULL));

-- 6. stripe_subscriptions: select policy
DROP POLICY IF EXISTS "Users can view their own subscription data" ON stripe_subscriptions;
CREATE POLICY "Users can view their own subscription data" ON stripe_subscriptions
  FOR SELECT TO authenticated
  USING (
    (customer_id IN (
      SELECT stripe_customers.customer_id
      FROM stripe_customers
      WHERE ((stripe_customers.user_id = (SELECT auth.uid())) AND (stripe_customers.deleted_at IS NULL))
    ))
    AND (deleted_at IS NULL)
  );

-- 7. stripe_orders: select policy
DROP POLICY IF EXISTS "Users can view their own order data" ON stripe_orders;
CREATE POLICY "Users can view their own order data" ON stripe_orders
  FOR SELECT TO authenticated
  USING (
    (customer_id IN (
      SELECT stripe_customers.customer_id
      FROM stripe_customers
      WHERE ((stripe_customers.user_id = (SELECT auth.uid())) AND (stripe_customers.deleted_at IS NULL))
    ))
    AND (deleted_at IS NULL)
  );

-- Add missing FK index on subscriptions.plan_key
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_key ON subscriptions(plan_key);
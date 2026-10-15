
-- Batch 2a: fixed_asset_types, internal schema, write policies

CREATE TABLE IF NOT EXISTS fixed_asset_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type_name text NOT NULL,
  type_code text NOT NULL DEFAULT '',
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fixed_asset_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can select own fixed_asset_types" ON fixed_asset_types FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own fixed_asset_types" ON fixed_asset_types FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own fixed_asset_types" ON fixed_asset_types FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own fixed_asset_types" ON fixed_asset_types FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Shared data access for manage and admin roles" ON fixed_asset_types FOR SELECT TO authenticated USING (has_data_access());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leases' AND column_name = 'fixed_asset_type_id') THEN
    ALTER TABLE leases ADD COLUMN fixed_asset_type_id uuid REFERENCES fixed_asset_types(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leases_fixed_asset_type_id ON leases(fixed_asset_type_id);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_types_user_id ON fixed_asset_types(user_id);

CREATE SCHEMA IF NOT EXISTS internal;

CREATE OR REPLACE FUNCTION internal.is_admin() RETURNS boolean AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'); END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.is_admin(check_user_id uuid) RETURNS boolean AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = check_user_id AND role = 'admin'); END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.is_manage_or_admin() RETURNS boolean AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role IN ('admin', 'manage')); END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.has_data_access() RETURNS boolean AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role IN ('admin', 'manage')); END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION internal.get_user_emails_for_admin() RETURNS TABLE(user_id uuid, email text) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.user_id = auth.uid() AND role IN ('admin', 'manage')) THEN RETURN; END IF;
  RETURN QUERY SELECT au.id AS user_id, au.email::text FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT USAGE ON SCHEMA internal TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.is_manage_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.has_data_access() TO authenticated;
GRANT EXECUTE ON FUNCTION internal.get_user_emails_for_admin() TO authenticated;
REVOKE ALL ON SCHEMA internal FROM public, anon;

CREATE OR REPLACE FUNCTION public.get_user_emails_for_admin() RETURNS TABLE(user_id uuid, email text)
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM internal.get_user_emails_for_admin(); $$;
REVOKE EXECUTE ON FUNCTION public.get_user_emails_for_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_emails_for_admin() TO authenticated;

CREATE POLICY "Manage and admin can insert leases" ON leases FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update leases" ON leases FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete leases" ON leases FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert lease_transactions" ON lease_transactions FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_transactions" ON lease_transactions FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_transactions" ON lease_transactions FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update transactions" ON transactions FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete transactions" ON transactions FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert month_end_documents" ON month_end_documents FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update month_end_documents" ON month_end_documents FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete month_end_documents" ON month_end_documents FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert documents" ON documents FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update documents" ON documents FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete documents" ON documents FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert lease_modifications" ON lease_modifications FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_modifications" ON lease_modifications FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_modifications" ON lease_modifications FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert contract_modifications" ON contract_modifications FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update contract_modifications" ON contract_modifications FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete contract_modifications" ON contract_modifications FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert contract_cancellations" ON contract_cancellations FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update contract_cancellations" ON contract_cancellations FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete contract_cancellations" ON contract_cancellations FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert amortization_schedules" ON amortization_schedules FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update amortization_schedules" ON amortization_schedules FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete amortization_schedules" ON amortization_schedules FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert lease_payment_schedules" ON lease_payment_schedules FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_payment_schedules" ON lease_payment_schedules FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_payment_schedules" ON lease_payment_schedules FOR DELETE TO authenticated USING (is_manage_or_admin());
CREATE POLICY "Manage and admin can insert branches" ON branches FOR INSERT TO authenticated WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can update branches" ON branches FOR UPDATE TO authenticated USING (is_manage_or_admin()) WITH CHECK (is_manage_or_admin());
CREATE POLICY "Manage and admin can delete branches" ON branches FOR DELETE TO authenticated USING (is_manage_or_admin());

CREATE INDEX IF NOT EXISTS idx_transactions_lease_date ON transactions (lease_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_lease_transactions_lease_date ON lease_transactions (lease_id, transaction_date);

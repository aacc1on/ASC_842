-- Replace all RLS policies that call public.is_admin(), public.is_manage_or_admin(),
-- or public.has_data_access() with internal.* equivalents.
-- Then drop the public.* functions to close the /rest/v1/rpc/ exposure.

-- user_profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON user_profiles;

CREATE POLICY "Admins can view all profiles" ON user_profiles FOR SELECT TO authenticated USING (internal.is_admin());
CREATE POLICY "Admins can update all profiles" ON user_profiles FOR UPDATE TO authenticated USING (internal.is_admin()) WITH CHECK (internal.is_admin());
CREATE POLICY "Admins can delete profiles" ON user_profiles FOR DELETE TO authenticated USING (internal.is_admin() AND user_id <> auth.uid());
CREATE POLICY "Manage role can view all profiles" ON user_profiles FOR SELECT TO authenticated USING (internal.is_manage_or_admin());
CREATE POLICY "Manage role can update user profiles" ON user_profiles FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());

-- leases
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON leases;
DROP POLICY IF EXISTS "Manage and admin can insert leases" ON leases;
DROP POLICY IF EXISTS "Manage and admin can update leases" ON leases;
DROP POLICY IF EXISTS "Manage and admin can delete leases" ON leases;

CREATE POLICY "Shared data access for manage and admin roles" ON leases FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert leases" ON leases FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update leases" ON leases FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete leases" ON leases FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- branches
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON branches;
DROP POLICY IF EXISTS "Manage and admin can insert branches" ON branches;
DROP POLICY IF EXISTS "Manage and admin can update branches" ON branches;
DROP POLICY IF EXISTS "Manage and admin can delete branches" ON branches;

CREATE POLICY "Shared data access for manage and admin roles" ON branches FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert branches" ON branches FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update branches" ON branches FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete branches" ON branches FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- documents
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON documents;
DROP POLICY IF EXISTS "Manage and admin can insert documents" ON documents;
DROP POLICY IF EXISTS "Manage and admin can update documents" ON documents;
DROP POLICY IF EXISTS "Manage and admin can delete documents" ON documents;

CREATE POLICY "Shared data access for manage and admin roles" ON documents FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert documents" ON documents FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update documents" ON documents FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete documents" ON documents FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- contract_modifications
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_modifications;
DROP POLICY IF EXISTS "Manage and admin can insert contract_modifications" ON contract_modifications;
DROP POLICY IF EXISTS "Manage and admin can update contract_modifications" ON contract_modifications;
DROP POLICY IF EXISTS "Manage and admin can delete contract_modifications" ON contract_modifications;

CREATE POLICY "Shared data access for manage and admin roles" ON contract_modifications FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert contract_modifications" ON contract_modifications FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update contract_modifications" ON contract_modifications FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete contract_modifications" ON contract_modifications FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- contract_cancellations
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON contract_cancellations;
DROP POLICY IF EXISTS "Manage and admin can insert contract_cancellations" ON contract_cancellations;
DROP POLICY IF EXISTS "Manage and admin can update contract_cancellations" ON contract_cancellations;
DROP POLICY IF EXISTS "Manage and admin can delete contract_cancellations" ON contract_cancellations;

CREATE POLICY "Shared data access for manage and admin roles" ON contract_cancellations FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert contract_cancellations" ON contract_cancellations FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update contract_cancellations" ON contract_cancellations FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete contract_cancellations" ON contract_cancellations FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- lease_transactions
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_transactions;
DROP POLICY IF EXISTS "Manage and admin can insert lease_transactions" ON lease_transactions;
DROP POLICY IF EXISTS "Manage and admin can update lease_transactions" ON lease_transactions;
DROP POLICY IF EXISTS "Manage and admin can delete lease_transactions" ON lease_transactions;

CREATE POLICY "Shared data access for manage and admin roles" ON lease_transactions FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert lease_transactions" ON lease_transactions FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_transactions" ON lease_transactions FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_transactions" ON lease_transactions FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- month_end_documents
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON month_end_documents;
DROP POLICY IF EXISTS "Manage and admin can insert month_end_documents" ON month_end_documents;
DROP POLICY IF EXISTS "Manage and admin can update month_end_documents" ON month_end_documents;
DROP POLICY IF EXISTS "Manage and admin can delete month_end_documents" ON month_end_documents;

CREATE POLICY "Shared data access for manage and admin roles" ON month_end_documents FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert month_end_documents" ON month_end_documents FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update month_end_documents" ON month_end_documents FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete month_end_documents" ON month_end_documents FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- accounting_periods
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON accounting_periods;
CREATE POLICY "Shared data access for manage and admin roles" ON accounting_periods FOR SELECT TO authenticated USING (internal.has_data_access());

-- transactions
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON transactions;
DROP POLICY IF EXISTS "Manage and admin can insert transactions" ON transactions;
DROP POLICY IF EXISTS "Manage and admin can update transactions" ON transactions;
DROP POLICY IF EXISTS "Manage and admin can delete transactions" ON transactions;

CREATE POLICY "Shared data access for manage and admin roles" ON transactions FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update transactions" ON transactions FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete transactions" ON transactions FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- fixed_asset_types
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON fixed_asset_types;
CREATE POLICY "Shared data access for manage and admin roles" ON fixed_asset_types FOR SELECT TO authenticated USING (internal.has_data_access());

-- amortization_schedules
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON amortization_schedules;
DROP POLICY IF EXISTS "Manage and admin can insert amortization_schedules" ON amortization_schedules;
DROP POLICY IF EXISTS "Manage and admin can update amortization_schedules" ON amortization_schedules;
DROP POLICY IF EXISTS "Manage and admin can delete amortization_schedules" ON amortization_schedules;

CREATE POLICY "Shared data access for manage and admin roles" ON amortization_schedules FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert amortization_schedules" ON amortization_schedules FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update amortization_schedules" ON amortization_schedules FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete amortization_schedules" ON amortization_schedules FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- journal_entries
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON journal_entries;
CREATE POLICY "Shared data access for manage and admin roles" ON journal_entries FOR SELECT TO authenticated USING (internal.has_data_access());

-- lease_modifications
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_modifications;
DROP POLICY IF EXISTS "Manage and admin can insert lease_modifications" ON lease_modifications;
DROP POLICY IF EXISTS "Manage and admin can update lease_modifications" ON lease_modifications;
DROP POLICY IF EXISTS "Manage and admin can delete lease_modifications" ON lease_modifications;

CREATE POLICY "Shared data access for manage and admin roles" ON lease_modifications FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert lease_modifications" ON lease_modifications FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_modifications" ON lease_modifications FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_modifications" ON lease_modifications FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- lease_payment_schedules
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Manage and admin can insert lease_payment_schedules" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Manage and admin can update lease_payment_schedules" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Manage and admin can delete lease_payment_schedules" ON lease_payment_schedules;

CREATE POLICY "Shared data access for manage and admin roles" ON lease_payment_schedules FOR SELECT TO authenticated USING (internal.has_data_access());
CREATE POLICY "Manage and admin can insert lease_payment_schedules" ON lease_payment_schedules FOR INSERT TO authenticated WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can update lease_payment_schedules" ON lease_payment_schedules FOR UPDATE TO authenticated USING (internal.is_manage_or_admin()) WITH CHECK (internal.is_manage_or_admin());
CREATE POLICY "Manage and admin can delete lease_payment_schedules" ON lease_payment_schedules FOR DELETE TO authenticated USING (internal.is_manage_or_admin());

-- lease_payments
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON lease_payments;
CREATE POLICY "Shared data access for manage and admin roles" ON lease_payments FOR SELECT TO authenticated USING (internal.has_data_access());

-- Drop public.* functions — no policies depend on them anymore
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_manage_or_admin();
DROP FUNCTION IF EXISTS public.has_data_access();

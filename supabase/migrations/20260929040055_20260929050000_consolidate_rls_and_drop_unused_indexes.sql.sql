/*
# Consolidate RLS policies and drop unused indexes

## RLS Policy Consolidation
Combines multiple permissive policies on the same table+action into one policy per action,
using OR to combine conditions. Access semantics are unchanged — the same users who could
access data before can still access it; those who couldn't still can't.
Restrictive policies (tenant_isolation_*, subscription_required_*) are NOT touched.

## Unused Index Cleanup
Drops indexes the performance advisor reports as unused, EXCEPT indexes on
organization_id, user_id, and foreign-key columns (those are kept for join/RLS performance).
*/
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.accounting_periods;
DROP POLICY IF EXISTS "Users can view own periods" ON public.accounting_periods;
CREATE POLICY "consolidated_select_accounting_periods" ON public.accounting_periods FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete amortization_schedules" ON public.amortization_schedules;
DROP POLICY IF EXISTS "Users can delete schedules for own leases" ON public.amortization_schedules;
CREATE POLICY "consolidated_delete_amortization_schedules" ON public.amortization_schedules FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can insert amortization_schedules" ON public.amortization_schedules;
DROP POLICY IF EXISTS "Users can insert schedules for own leases" ON public.amortization_schedules;
CREATE POLICY "consolidated_insert_amortization_schedules" ON public.amortization_schedules FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.amortization_schedules;
DROP POLICY IF EXISTS "Users can view schedules for own leases" ON public.amortization_schedules;
CREATE POLICY "consolidated_select_amortization_schedules" ON public.amortization_schedules FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can update amortization_schedules" ON public.amortization_schedules;
DROP POLICY IF EXISTS "Users can update schedules for own leases" ON public.amortization_schedules;
CREATE POLICY "consolidated_update_amortization_schedules" ON public.amortization_schedules FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = amortization_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can delete branches" ON public.branches;
DROP POLICY IF EXISTS "Users can delete own branches" ON public.branches;
CREATE POLICY "consolidated_delete_branches" ON public.branches FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert branches" ON public.branches;
DROP POLICY IF EXISTS "Users can insert own branches" ON public.branches;
CREATE POLICY "consolidated_insert_branches" ON public.branches FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.branches;
DROP POLICY IF EXISTS "Users can view own branches" ON public.branches;
CREATE POLICY "consolidated_select_branches" ON public.branches FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update branches" ON public.branches;
DROP POLICY IF EXISTS "Users can update own branches" ON public.branches;
CREATE POLICY "consolidated_update_branches" ON public.branches FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "manage_select_companies" ON public.companies;
DROP POLICY IF EXISTS "select_own_companies" ON public.companies;
CREATE POLICY "consolidated_select_companies" ON public.companies FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete contract_cancellations" ON public.contract_cancellations;
DROP POLICY IF EXISTS "Users can delete own cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_delete_contract_cancellations" ON public.contract_cancellations FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert contract_cancellations" ON public.contract_cancellations;
DROP POLICY IF EXISTS "Users can insert own cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_insert_contract_cancellations" ON public.contract_cancellations FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.contract_cancellations;
DROP POLICY IF EXISTS "Users can view own cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_select_contract_cancellations" ON public.contract_cancellations FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update contract_cancellations" ON public.contract_cancellations;
DROP POLICY IF EXISTS "Users can update own cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_update_contract_cancellations" ON public.contract_cancellations FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete contract_modifications" ON public.contract_modifications;
DROP POLICY IF EXISTS "Users can delete own modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_delete_contract_modifications" ON public.contract_modifications FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert contract_modifications" ON public.contract_modifications;
DROP POLICY IF EXISTS "Users can insert own modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_insert_contract_modifications" ON public.contract_modifications FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.contract_modifications;
DROP POLICY IF EXISTS "Users can view own modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_select_contract_modifications" ON public.contract_modifications FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update contract_modifications" ON public.contract_modifications;
DROP POLICY IF EXISTS "Users can update own modifications" ON public.contract_modifications;
CREATE POLICY "consolidated_update_contract_modifications" ON public.contract_modifications FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "consolidated_delete_documents" ON public.documents FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "consolidated_insert_documents" ON public.documents FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.documents;
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "consolidated_select_documents" ON public.documents FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
CREATE POLICY "consolidated_update_documents" ON public.documents FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.fixed_asset_types;
DROP POLICY IF EXISTS "Users can select own fixed_asset_types" ON public.fixed_asset_types;
CREATE POLICY "consolidated_select_fixed_asset_types" ON public.fixed_asset_types FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.journal_entries;
DROP POLICY IF EXISTS "Users can view entries for own leases" ON public.journal_entries;
CREATE POLICY "consolidated_select_journal_entries" ON public.journal_entries FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = journal_entries.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can delete lease_modifications" ON public.lease_modifications;
DROP POLICY IF EXISTS "Users can delete modifications for own leases" ON public.lease_modifications;
CREATE POLICY "consolidated_delete_lease_modifications" ON public.lease_modifications FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can insert lease_modifications" ON public.lease_modifications;
DROP POLICY IF EXISTS "Users can insert modifications for own leases" ON public.lease_modifications;
CREATE POLICY "consolidated_insert_lease_modifications" ON public.lease_modifications FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.lease_modifications;
DROP POLICY IF EXISTS "Users can view modifications for own leases" ON public.lease_modifications;
CREATE POLICY "consolidated_select_lease_modifications" ON public.lease_modifications FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can update lease_modifications" ON public.lease_modifications;
DROP POLICY IF EXISTS "Users can update modifications for own leases" ON public.lease_modifications;
CREATE POLICY "consolidated_update_lease_modifications" ON public.lease_modifications FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_modifications.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can delete lease_payment_schedules" ON public.lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can delete payment schedules" ON public.lease_payment_schedules;
CREATE POLICY "consolidated_delete_lease_payment_schedules" ON public.lease_payment_schedules FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can insert lease_payment_schedules" ON public.lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can insert payment schedules" ON public.lease_payment_schedules;
CREATE POLICY "consolidated_insert_lease_payment_schedules" ON public.lease_payment_schedules FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Owner can view payment schedules" ON public.lease_payment_schedules;
DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.lease_payment_schedules;
CREATE POLICY "consolidated_select_lease_payment_schedules" ON public.lease_payment_schedules FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))) OR (internal.has_data_access()));

DROP POLICY IF EXISTS "Manage and admin can update lease_payment_schedules" ON public.lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can update payment schedules" ON public.lease_payment_schedules;
CREATE POLICY "consolidated_update_lease_payment_schedules" ON public.lease_payment_schedules FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payment_schedules.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.lease_payments;
DROP POLICY IF EXISTS "Users can view payments for own leases" ON public.lease_payments;
CREATE POLICY "consolidated_select_lease_payments" ON public.lease_payments FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_payments.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can delete lease_transactions" ON public.lease_transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.lease_transactions;
CREATE POLICY "consolidated_delete_lease_transactions" ON public.lease_transactions FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))));

DROP POLICY IF EXISTS "Manage and admin can insert lease_transactions" ON public.lease_transactions;
DROP POLICY IF EXISTS "Users can insert transactions for their leases" ON public.lease_transactions;
CREATE POLICY "consolidated_insert_lease_transactions" ON public.lease_transactions FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.lease_transactions;
DROP POLICY IF EXISTS "Users can view transactions for their leases" ON public.lease_transactions;
CREATE POLICY "consolidated_select_lease_transactions" ON public.lease_transactions FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Manage and admin can update lease_transactions" ON public.lease_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.lease_transactions;
CREATE POLICY "consolidated_update_lease_transactions" ON public.lease_transactions FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid)))))))) WITH CHECK ((internal.is_manage_or_admin()) OR (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leases
  WHERE ((leases.id = lease_transactions.lease_id) AND (leases.user_id = ( SELECT auth.uid() AS uid))))))));

DROP POLICY IF EXISTS "Manage and admin can delete leases" ON public.leases;
DROP POLICY IF EXISTS "Users can delete own leases" ON public.leases;
CREATE POLICY "consolidated_delete_leases" ON public.leases FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert leases" ON public.leases;
DROP POLICY IF EXISTS "Users can insert own leases" ON public.leases;
CREATE POLICY "consolidated_insert_leases" ON public.leases FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.leases;
DROP POLICY IF EXISTS "Users can view own leases" ON public.leases;
CREATE POLICY "consolidated_select_leases" ON public.leases FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update leases" ON public.leases;
DROP POLICY IF EXISTS "Users can update own leases" ON public.leases;
CREATE POLICY "consolidated_update_leases" ON public.leases FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete month_end_documents" ON public.month_end_documents;
DROP POLICY IF EXISTS "Users can delete own month-end documents" ON public.month_end_documents;
CREATE POLICY "consolidated_delete_month_end_documents" ON public.month_end_documents FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert month_end_documents" ON public.month_end_documents;
DROP POLICY IF EXISTS "Users can insert own month-end documents" ON public.month_end_documents;
CREATE POLICY "consolidated_insert_month_end_documents" ON public.month_end_documents FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.month_end_documents;
DROP POLICY IF EXISTS "Users can view own month-end documents" ON public.month_end_documents;
CREATE POLICY "consolidated_select_month_end_documents" ON public.month_end_documents FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update month_end_documents" ON public.month_end_documents;
DROP POLICY IF EXISTS "Users can update own month-end documents" ON public.month_end_documents;
CREATE POLICY "consolidated_update_month_end_documents" ON public.month_end_documents FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can delete transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY "consolidated_delete_transactions" ON public.transactions FOR DELETE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "consolidated_insert_transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Shared data access for manage and admin roles" ON public.transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "consolidated_select_transactions" ON public.transactions FOR SELECT TO authenticated USING ((internal.has_data_access()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Manage and admin can update transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "consolidated_update_transactions" ON public.transactions FOR UPDATE TO authenticated USING ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Admins can delete profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.user_profiles;
CREATE POLICY "consolidated_delete_user_profiles" ON public.user_profiles FOR DELETE TO authenticated USING (((internal.is_admin() AND (user_id <> ( SELECT auth.uid() AS uid)))) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Manage role can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "consolidated_select_user_profiles" ON public.user_profiles FOR SELECT TO authenticated USING ((internal.is_admin()) OR (internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Manage role can update user profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "consolidated_update_user_profiles" ON public.user_profiles FOR UPDATE TO authenticated USING ((internal.is_admin()) OR (internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((internal.is_admin()) OR (internal.is_manage_or_admin()) OR ((( SELECT auth.uid() AS uid) = user_id)));

-- Drop unused non-protected indexes
DROP INDEX IF EXISTS public.idx_amortization_lease_period;
DROP INDEX IF EXISTS public.idx_lease_transactions_type;
DROP INDEX IF EXISTS public.idx_leases_user_classification;
DROP INDEX IF EXISTS public.idx_leases_user_created;
DROP INDEX IF EXISTS public.idx_leases_user_lessor_name;
DROP INDEX IF EXISTS public.idx_leases_user_lessor_type;
DROP INDEX IF EXISTS public.idx_modifications_lease_status;
DROP INDEX IF EXISTS public.idx_month_end_documents_user_period;
DROP INDEX IF EXISTS public.idx_subscriptions_plan_key;
DROP INDEX IF EXISTS public.idx_transactions_month_end_doc;
DROP INDEX IF EXISTS public.idx_transactions_period;
DROP INDEX IF EXISTS public.idx_transactions_reversal_of;
DROP INDEX IF EXISTS public.idx_transactions_user_date_desc;
DROP INDEX IF EXISTS public.idx_transactions_user_period;
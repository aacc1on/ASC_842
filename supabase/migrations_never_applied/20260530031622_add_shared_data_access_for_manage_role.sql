/*
  # Grant manage/view role users access to all lease data

  1. New Functions
    - `has_data_access()` - Returns true if the current user has 'manage' or 'admin' role
    - Used in RLS policies to grant cross-user data visibility

  2. Security Changes
    - Adds permissive SELECT policies on all data tables so that users with
      'manage' or 'admin' roles can view all records (not just their own)
    - Tables affected:
      - leases
      - branches
      - documents
      - contract_modifications
      - contract_cancellations
      - lease_transactions
      - month_end_documents
      - accounting_periods
      - transactions
      - fixed_asset_types
      - amortization_schedules
      - journal_entries
      - lease_modifications
      - lease_payment_schedules
      - lease_payments
    - Does NOT grant write access (insert/update/delete) across users
    - Does NOT affect user_profiles or user_activity_logs admin policies

  3. Important Notes
    - 'manage' role users can see all data but admin functions (user management) remain restricted
    - 'view' role users can also see all data (read-only role)
    - Write operations remain restricted to the data owner (user_id = auth.uid())
    - The helper function is SECURITY DEFINER to access user_profiles reliably
    - EXECUTE is restricted to authenticated role only
*/

-- Helper function to check if current user has data access (manage, admin, or view role)
CREATE OR REPLACE FUNCTION has_data_access()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage', 'view')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Restrict execute to authenticated only
REVOKE EXECUTE ON FUNCTION public.has_data_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_data_access() TO authenticated;

-- Leases: manage/admin/view can see all
CREATE POLICY "Shared data access for manage and admin roles"
  ON leases FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Branches
CREATE POLICY "Shared data access for manage and admin roles"
  ON branches FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Documents
CREATE POLICY "Shared data access for manage and admin roles"
  ON documents FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Contract modifications
CREATE POLICY "Shared data access for manage and admin roles"
  ON contract_modifications FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Contract cancellations
CREATE POLICY "Shared data access for manage and admin roles"
  ON contract_cancellations FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Lease transactions
CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_transactions FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Month end documents
CREATE POLICY "Shared data access for manage and admin roles"
  ON month_end_documents FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Accounting periods
CREATE POLICY "Shared data access for manage and admin roles"
  ON accounting_periods FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Transactions
CREATE POLICY "Shared data access for manage and admin roles"
  ON transactions FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Fixed asset types
CREATE POLICY "Shared data access for manage and admin roles"
  ON fixed_asset_types FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Amortization schedules
CREATE POLICY "Shared data access for manage and admin roles"
  ON amortization_schedules FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Journal entries
CREATE POLICY "Shared data access for manage and admin roles"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Lease modifications
CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_modifications FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Lease payment schedules
CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_payment_schedules FOR SELECT
  TO authenticated
  USING (has_data_access());

-- Lease payments
CREATE POLICY "Shared data access for manage and admin roles"
  ON lease_payments FOR SELECT
  TO authenticated
  USING (has_data_access());

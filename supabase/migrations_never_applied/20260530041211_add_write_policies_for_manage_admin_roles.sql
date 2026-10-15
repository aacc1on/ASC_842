/*
  # Add write access policies for Manage and Admin roles

  1. Problem
    - Manage/Admin users can VIEW all data via shared data access policies
    - But INSERT, UPDATE, DELETE policies only allow operations on records where user_id = auth.uid()
    - This means Manage/Admin users cannot edit, delete, or create transactions for
      leases owned by other users

  2. Fix
    - Add INSERT, UPDATE, DELETE policies for manage/admin roles on all relevant tables
    - These policies use internal.is_manage_or_admin() to check role

  3. Affected Tables
    - leases (create, edit, delete)
    - lease_transactions (create, delete for reversals)
    - transactions (create, update, delete)
    - month_end_documents (create, update, delete)
    - documents (create, update, delete)
    - lease_modifications (create, update, delete)
    - contract_modifications (create, update, delete)
    - contract_cancellations (create, update, delete)
    - amortization_schedules (insert for schedule generation)
    - lease_payment_schedules (insert for schedule generation)
*/

-- leases: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert leases"
  ON leases FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update leases"
  ON leases FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete leases"
  ON leases FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- lease_transactions: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert lease_transactions"
  ON lease_transactions FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update lease_transactions"
  ON lease_transactions FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete lease_transactions"
  ON lease_transactions FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- transactions: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert transactions"
  ON transactions FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete transactions"
  ON transactions FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- month_end_documents: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert month_end_documents"
  ON month_end_documents FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update month_end_documents"
  ON month_end_documents FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete month_end_documents"
  ON month_end_documents FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- documents: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert documents"
  ON documents FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update documents"
  ON documents FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete documents"
  ON documents FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- lease_modifications: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert lease_modifications"
  ON lease_modifications FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update lease_modifications"
  ON lease_modifications FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete lease_modifications"
  ON lease_modifications FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- contract_modifications: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert contract_modifications"
  ON contract_modifications FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update contract_modifications"
  ON contract_modifications FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete contract_modifications"
  ON contract_modifications FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- contract_cancellations: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert contract_cancellations"
  ON contract_cancellations FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update contract_cancellations"
  ON contract_cancellations FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete contract_cancellations"
  ON contract_cancellations FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- amortization_schedules: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert amortization_schedules"
  ON amortization_schedules FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update amortization_schedules"
  ON amortization_schedules FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete amortization_schedules"
  ON amortization_schedules FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- lease_payment_schedules: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert lease_payment_schedules"
  ON lease_payment_schedules FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update lease_payment_schedules"
  ON lease_payment_schedules FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete lease_payment_schedules"
  ON lease_payment_schedules FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());

-- branches: manage/admin can insert, update, delete
CREATE POLICY "Manage and admin can insert branches"
  ON branches FOR INSERT TO authenticated
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can update branches"
  ON branches FOR UPDATE TO authenticated
  USING (internal.is_manage_or_admin())
  WITH CHECK (internal.is_manage_or_admin());

CREATE POLICY "Manage and admin can delete branches"
  ON branches FOR DELETE TO authenticated
  USING (internal.is_manage_or_admin());
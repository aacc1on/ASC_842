/*
  # Fix RLS Auth Initialization Plan — All Tables

  ## Problem
  Every policy that calls auth.uid() directly causes Postgres to re-evaluate the
  function for every row scanned. Wrapping it in a sub-select — (select auth.uid())
  — allows Postgres to evaluate it once per query and cache the result, which can
  give dramatic speedups on large tables.

  ## Tables Fixed
  - leases (4 policies)
  - lease_payments (4 policies)
  - amortization_schedules (4 policies)
  - journal_entries (4 policies)
  - lease_modifications (4 policies)
  - user_profiles (4 policies)
  - user_activity_logs (2 policies)
  - documents (4 policies)
  - transactions (4 policies)
  - contract_modifications (4 policies)
  - contract_cancellations (4 policies)
  - accounting_periods (4 policies)
  - branches (4 policies)
  - lease_transactions (4 policies)
  - month_end_documents (3 policies)
  - lease_payment_schedules (4 policies)

  ## Approach
  Drop and recreate each policy with (select auth.uid()) substituted for auth.uid().
  The EXISTS(...) subqueries on child tables (that join to leases) also get the fix
  since they all ultimately resolve via leases.user_id = auth.uid().
*/

-- ============================================================
-- leases
-- ============================================================
DROP POLICY IF EXISTS "Users can view own leases" ON leases;
DROP POLICY IF EXISTS "Users can insert own leases" ON leases;
DROP POLICY IF EXISTS "Users can update own leases" ON leases;
DROP POLICY IF EXISTS "Users can delete own leases" ON leases;

CREATE POLICY "Users can view own leases"
  ON leases FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own leases"
  ON leases FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own leases"
  ON leases FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own leases"
  ON leases FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- lease_payments
-- ============================================================
DROP POLICY IF EXISTS "Users can view payments for own leases" ON lease_payments;
DROP POLICY IF EXISTS "Users can insert payments for own leases" ON lease_payments;
DROP POLICY IF EXISTS "Users can update payments for own leases" ON lease_payments;
DROP POLICY IF EXISTS "Users can delete payments for own leases" ON lease_payments;

CREATE POLICY "Users can view payments for own leases"
  ON lease_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payments.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can insert payments for own leases"
  ON lease_payments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payments.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can update payments for own leases"
  ON lease_payments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payments.lease_id
      AND leases.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payments.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can delete payments for own leases"
  ON lease_payments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payments.lease_id
      AND leases.user_id = (select auth.uid())
  ));

-- ============================================================
-- amortization_schedules
-- ============================================================
DROP POLICY IF EXISTS "Users can view schedules for own leases" ON amortization_schedules;
DROP POLICY IF EXISTS "Users can insert schedules for own leases" ON amortization_schedules;
DROP POLICY IF EXISTS "Users can update schedules for own leases" ON amortization_schedules;
DROP POLICY IF EXISTS "Users can delete schedules for own leases" ON amortization_schedules;

CREATE POLICY "Users can view schedules for own leases"
  ON amortization_schedules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = amortization_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can insert schedules for own leases"
  ON amortization_schedules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = amortization_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can update schedules for own leases"
  ON amortization_schedules FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = amortization_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = amortization_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can delete schedules for own leases"
  ON amortization_schedules FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = amortization_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

-- ============================================================
-- journal_entries
-- ============================================================
DROP POLICY IF EXISTS "Users can view entries for own leases" ON journal_entries;
DROP POLICY IF EXISTS "Users can insert entries for own leases" ON journal_entries;
DROP POLICY IF EXISTS "Users can update entries for own leases" ON journal_entries;
DROP POLICY IF EXISTS "Users can delete entries for own leases" ON journal_entries;

CREATE POLICY "Users can view entries for own leases"
  ON journal_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = journal_entries.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can insert entries for own leases"
  ON journal_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = journal_entries.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can update entries for own leases"
  ON journal_entries FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = journal_entries.lease_id
      AND leases.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = journal_entries.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can delete entries for own leases"
  ON journal_entries FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = journal_entries.lease_id
      AND leases.user_id = (select auth.uid())
  ));

-- ============================================================
-- lease_modifications
-- ============================================================
DROP POLICY IF EXISTS "Users can view modifications for own leases" ON lease_modifications;
DROP POLICY IF EXISTS "Users can insert modifications for own leases" ON lease_modifications;
DROP POLICY IF EXISTS "Users can update modifications for own leases" ON lease_modifications;
DROP POLICY IF EXISTS "Users can delete modifications for own leases" ON lease_modifications;

CREATE POLICY "Users can view modifications for own leases"
  ON lease_modifications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_modifications.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can insert modifications for own leases"
  ON lease_modifications FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_modifications.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can update modifications for own leases"
  ON lease_modifications FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_modifications.lease_id
      AND leases.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_modifications.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can delete modifications for own leases"
  ON lease_modifications FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_modifications.lease_id
      AND leases.user_id = (select auth.uid())
  ));

-- ============================================================
-- user_profiles
-- ============================================================
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON user_profiles;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- user_activity_logs
-- ============================================================
DROP POLICY IF EXISTS "Users can view own activity logs" ON user_activity_logs;
DROP POLICY IF EXISTS "Users can insert own activity logs" ON user_activity_logs;

CREATE POLICY "Users can view own activity logs"
  ON user_activity_logs FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own activity logs"
  ON user_activity_logs FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- ============================================================
-- documents
-- ============================================================
DROP POLICY IF EXISTS "Users can view own documents" ON documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON documents;
DROP POLICY IF EXISTS "Users can update own documents" ON documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON documents;

CREATE POLICY "Users can view own documents"
  ON documents FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own documents"
  ON documents FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own documents"
  ON documents FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- transactions
-- ============================================================
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON transactions;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- contract_modifications
-- ============================================================
DROP POLICY IF EXISTS "Users can view own modifications" ON contract_modifications;
DROP POLICY IF EXISTS "Users can insert own modifications" ON contract_modifications;
DROP POLICY IF EXISTS "Users can update own modifications" ON contract_modifications;
DROP POLICY IF EXISTS "Users can delete own modifications" ON contract_modifications;

CREATE POLICY "Users can view own modifications"
  ON contract_modifications FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own modifications"
  ON contract_modifications FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own modifications"
  ON contract_modifications FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own modifications"
  ON contract_modifications FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- contract_cancellations
-- ============================================================
DROP POLICY IF EXISTS "Users can view own cancellations" ON contract_cancellations;
DROP POLICY IF EXISTS "Users can insert own cancellations" ON contract_cancellations;
DROP POLICY IF EXISTS "Users can update own cancellations" ON contract_cancellations;
DROP POLICY IF EXISTS "Users can delete own cancellations" ON contract_cancellations;

CREATE POLICY "Users can view own cancellations"
  ON contract_cancellations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own cancellations"
  ON contract_cancellations FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own cancellations"
  ON contract_cancellations FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own cancellations"
  ON contract_cancellations FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- accounting_periods
-- ============================================================
DROP POLICY IF EXISTS "Users can view own periods" ON accounting_periods;
DROP POLICY IF EXISTS "Users can insert own periods" ON accounting_periods;
DROP POLICY IF EXISTS "Users can update own periods" ON accounting_periods;
DROP POLICY IF EXISTS "Users can delete own periods" ON accounting_periods;

CREATE POLICY "Users can view own periods"
  ON accounting_periods FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own periods"
  ON accounting_periods FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own periods"
  ON accounting_periods FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own periods"
  ON accounting_periods FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- branches
-- ============================================================
DROP POLICY IF EXISTS "Users can view own branches" ON branches;
DROP POLICY IF EXISTS "Users can insert own branches" ON branches;
DROP POLICY IF EXISTS "Users can update own branches" ON branches;
DROP POLICY IF EXISTS "Users can delete own branches" ON branches;

CREATE POLICY "Users can view own branches"
  ON branches FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own branches"
  ON branches FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own branches"
  ON branches FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own branches"
  ON branches FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- lease_transactions
-- ============================================================
DROP POLICY IF EXISTS "Users can view transactions for their leases" ON lease_transactions;
DROP POLICY IF EXISTS "Users can insert transactions for their leases" ON lease_transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON lease_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON lease_transactions;

CREATE POLICY "Users can view transactions for their leases"
  ON lease_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_transactions.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can insert transactions for their leases"
  ON lease_transactions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_transactions.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can update their own transactions"
  ON lease_transactions FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can delete their own transactions"
  ON lease_transactions FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- month_end_documents
-- ============================================================
DROP POLICY IF EXISTS "Users can view own month-end documents" ON month_end_documents;
DROP POLICY IF EXISTS "Users can insert own month-end documents" ON month_end_documents;
DROP POLICY IF EXISTS "Users can delete own month-end documents" ON month_end_documents;

CREATE POLICY "Users can view own month-end documents"
  ON month_end_documents FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own month-end documents"
  ON month_end_documents FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own month-end documents"
  ON month_end_documents FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- lease_payment_schedules
-- ============================================================
DROP POLICY IF EXISTS "Owner can view payment schedules" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can insert payment schedules" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can update payment schedules" ON lease_payment_schedules;
DROP POLICY IF EXISTS "Owner can delete payment schedules" ON lease_payment_schedules;

CREATE POLICY "Owner can view payment schedules"
  ON lease_payment_schedules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payment_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Owner can insert payment schedules"
  ON lease_payment_schedules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payment_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Owner can update payment schedules"
  ON lease_payment_schedules FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payment_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payment_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

CREATE POLICY "Owner can delete payment schedules"
  ON lease_payment_schedules FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases
    WHERE leases.id = lease_payment_schedules.lease_id
      AND leases.user_id = (select auth.uid())
  ));

/*
  Fix companies RLS policy to use SECURITY DEFINER function.
  The inline subquery on user_profiles can cause circular RLS evaluation.
  Use internal.has_data_access() which is SECURITY DEFINER and bypasses RLS.
*/

DROP POLICY IF EXISTS "manage_select_companies" ON companies;

CREATE POLICY "manage_select_companies" ON companies FOR SELECT
  TO authenticated
  USING (internal.has_data_access());

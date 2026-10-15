/*
  # Fix month_end_documents UPDATE policy consistency

  The UPDATE policy on month_end_documents uses `auth.uid()` directly
  while all other policies use `(SELECT auth.uid() AS uid)` which is
  evaluated once per query (more performant and consistent).

  This migration drops and recreates the UPDATE policy to match the
  standardized pattern used across all other tables.
*/

DROP POLICY IF EXISTS "Users can update own month-end documents" ON month_end_documents;

CREATE POLICY "Users can update own month-end documents"
  ON month_end_documents
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid() AS uid) = user_id)
  WITH CHECK ((SELECT auth.uid() AS uid) = user_id);

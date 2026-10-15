/*
  # Fix lease_transactions RLS and nullable user_id

  ## Problem
  The lease_transactions table has a nullable user_id column. The DELETE and UPDATE
  policies check `user_id = auth.uid()`, which evaluates to NULL (not TRUE) when
  user_id IS NULL — meaning those rows can never be deleted or updated by anyone,
  even the lease owner. This is a silent data-access bug.

  ## Fix
  1. Backfill NULL user_id values by joining to the leases table.
  2. Drop the broken DELETE and UPDATE policies.
  3. Re-create them to allow access when user_id matches OR when the row's lease
     belongs to the current user (covers any future nulls gracefully).

  ## Changes
  - Backfills lease_transactions.user_id where NULL
  - Replaces DELETE policy to use owner-of-lease fallback
  - Replaces UPDATE policy to use owner-of-lease fallback
*/

UPDATE lease_transactions lt
SET user_id = l.user_id
FROM leases l
WHERE lt.lease_id = l.id
  AND lt.user_id IS NULL;

DROP POLICY IF EXISTS "Users can delete their own transactions" ON lease_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON lease_transactions;

CREATE POLICY "Users can delete their own transactions"
  ON lease_transactions
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own transactions"
  ON lease_transactions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
        AND leases.user_id = auth.uid()
    )
  );

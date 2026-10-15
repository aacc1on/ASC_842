/*
  # Month-End Documents and Transaction Linkage

  ## Summary
  This migration adds support for month-end process documents. When a user runs
  the month-end closing process, a document record is created to represent that
  posting batch. All transactions created in that batch are linked back to the
  document so they can be viewed and deleted together.

  ## Changes

  ### New Table: `month_end_documents`
  - `id` (uuid, primary key) — unique document ID
  - `user_id` (uuid) — owner, references auth.users
  - `period` (text) — accounting period in YYYY-MM format (e.g., "2025-01")
  - `period_label` (text) — human-readable label (e.g., "January 2025")
  - `lease_count` (integer) — number of leases processed
  - `transaction_count` (integer) — total journal entries created
  - `total_interest` (numeric) — total interest expense recorded
  - `total_depreciation` (numeric) — total depreciation/amortization recorded
  - `total_principal` (numeric) — total principal reduction recorded
  - `status` (text) — 'posted' or 'reversed'
  - `created_at` (timestamptz) — when the document was created

  ### Modified Table: `transactions`
  - Added `month_end_document_id` (uuid, nullable) — links a transaction back
    to the month-end document that created it

  ## Security
  - RLS enabled on `month_end_documents`
  - Users can only view and delete their own documents
*/

CREATE TABLE IF NOT EXISTS month_end_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period text NOT NULL,
  period_label text NOT NULL,
  lease_count integer NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  total_interest numeric NOT NULL DEFAULT 0,
  total_depreciation numeric NOT NULL DEFAULT 0,
  total_principal numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE month_end_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own month-end documents"
  ON month_end_documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own month-end documents"
  ON month_end_documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own month-end documents"
  ON month_end_documents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'month_end_document_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN month_end_document_id uuid REFERENCES month_end_documents(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_month_end_doc
  ON transactions(month_end_document_id)
  WHERE month_end_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_month_end_documents_user_period
  ON month_end_documents(user_id, period);

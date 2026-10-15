/*
  # Create Lease Transactions Table

  1. New Tables
    - `lease_transactions`
      - `id` (uuid, primary key) - Unique transaction identifier
      - `lease_id` (uuid, foreign key) - Reference to the lease
      - `modification_id` (uuid, foreign key, nullable) - Reference to modification if applicable
      - `transaction_date` (date) - Date of the transaction
      - `transaction_type` (text) - Type: 'initial_recognition', 'modification', 'remeasurement'
      - `description` (text) - Description of the transaction
      - `account_debited` (text) - Account being debited
      - `account_credited` (text) - Account being credited
      - `amount` (numeric) - Transaction amount
      - `created_at` (timestamptz) - Record creation timestamp
      - `user_id` (uuid, foreign key) - User who created the transaction

  2. Security
    - Enable RLS on `lease_transactions` table
    - Add policy for authenticated users to read their own organization's transactions
    - Add policy for authenticated users to insert transactions for their leases
    - Add policy for authenticated users to update their own transactions
    - Add policy for authenticated users to delete their own transactions

  3. Indexes
    - Create index on lease_id for faster lookups
    - Create index on transaction_date for reporting
    - Create index on transaction_type for filtering
*/

CREATE TABLE IF NOT EXISTS lease_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  modification_id uuid REFERENCES contract_modifications(id) ON DELETE SET NULL,
  transaction_date date NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('initial_recognition', 'modification', 'remeasurement', 'termination')),
  description text NOT NULL,
  account_debited text NOT NULL,
  account_credited text NOT NULL,
  amount numeric(15, 2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE lease_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transactions for their leases"
  ON lease_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
      AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert transactions for their leases"
  ON lease_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_transactions.lease_id
      AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own transactions"
  ON lease_transactions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own transactions"
  ON lease_transactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_lease_transactions_lease_id ON lease_transactions(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_transactions_date ON lease_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_lease_transactions_type ON lease_transactions(transaction_type);

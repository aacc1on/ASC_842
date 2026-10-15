/*
  # Create Comprehensive Accounting Module

  ## 1. New Tables
    
    ### `transactions`
      - `id` (uuid, primary key) - Unique transaction identifier
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `lease_id` (uuid, foreign key) - References leases.id
      - `transaction_date` (date) - Date of the transaction
      - `transaction_type` (text) - Type: 'payment', 'interest', 'amortization', 'initial_recognition', 'modification', 'impairment', 'derecognition'
      - `account_debited` (text) - Account debited
      - `account_credited` (text) - Account credited
      - `debit_amount` (decimal) - Debit amount
      - `credit_amount` (decimal) - Credit amount
      - `description` (text) - Transaction description
      - `reference_number` (text) - Reference/invoice number
      - `period` (text) - Accounting period (YYYY-MM)
      - `is_reversed` (boolean) - Whether transaction is reversed
      - `reversal_of` (uuid) - References transactions.id if this reverses another
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

    ### `contract_modifications`
      - `id` (uuid, primary key) - Unique modification identifier
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `lease_id` (uuid, foreign key) - References leases.id
      - `modification_date` (date) - Date of modification
      - `modification_type` (text) - Type: 'payment_change', 'term_extension', 'term_reduction', 'scope_change', 'rate_change'
      - `reason` (text) - Reason for modification
      - `old_monthly_payment` (decimal) - Previous payment amount
      - `new_monthly_payment` (decimal) - New payment amount
      - `old_lease_term` (integer) - Previous term in months
      - `new_lease_term` (integer) - New term in months
      - `old_discount_rate` (decimal) - Previous discount rate
      - `new_discount_rate` (decimal) - New discount rate
      - `old_rou_asset` (decimal) - Previous ROU asset value
      - `new_rou_asset` (decimal) - New ROU asset value
      - `old_lease_liability` (decimal) - Previous lease liability
      - `new_lease_liability` (decimal) - New lease liability
      - `accounting_treatment` (text) - How modification was accounted for
      - `remeasurement_required` (boolean) - Whether remeasurement is needed
      - `notes` (text) - Additional notes
      - `approved_by` (text) - Approver name
      - `status` (text) - Status: 'draft', 'pending_approval', 'approved', 'rejected', 'applied'
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

    ### `contract_cancellations`
      - `id` (uuid, primary key) - Unique cancellation identifier
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `lease_id` (uuid, foreign key) - References leases.id
      - `cancellation_date` (date) - Date of cancellation
      - `cancellation_reason` (text) - Reason for cancellation
      - `early_termination` (boolean) - Whether early termination
      - `termination_penalty` (decimal) - Penalty amount if applicable
      - `remaining_rou_asset` (decimal) - ROU asset value at cancellation
      - `remaining_lease_liability` (decimal) - Lease liability at cancellation
      - `gain_loss_amount` (decimal) - Gain or loss on cancellation
      - `final_payment_amount` (decimal) - Final payment made
      - `settlement_details` (text) - Settlement details
      - `approved_by` (text) - Approver name
      - `status` (text) - Status: 'draft', 'pending_approval', 'approved', 'rejected', 'completed'
      - `derecognition_posted` (boolean) - Whether derecognition entry posted
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

    ### `accounting_periods`
      - `id` (uuid, primary key) - Unique period identifier
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `period` (text) - Period in YYYY-MM format
      - `period_start` (date) - Period start date
      - `period_end` (date) - Period end date
      - `status` (text) - Status: 'open', 'closed', 'locked'
      - `total_debits` (decimal) - Total debits for period
      - `total_credits` (decimal) - Total credits for period
      - `closed_by` (text) - Who closed the period
      - `closed_at` (timestamptz) - When period was closed
      - `created_at` (timestamptz) - Creation timestamp

  ## 2. Security
    - Enable RLS on all tables
    - Users can only access their own records
    - Create comprehensive policies for all operations

  ## 3. Indexes
    - Create indexes for performance optimization
    - Index on foreign keys, dates, and status fields

  ## 4. Important Notes
    - Transactions track all accounting entries for audit trail
    - Contract modifications track changes with before/after values
    - Cancellations handle early terminations and penalties
    - Accounting periods allow for period-end closing
    - All monetary values use decimal for precision
*/

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  transaction_type text NOT NULL DEFAULT 'payment',
  account_debited text NOT NULL DEFAULT '',
  account_credited text NOT NULL DEFAULT '',
  debit_amount decimal(15,2) NOT NULL DEFAULT 0,
  credit_amount decimal(15,2) NOT NULL DEFAULT 0,
  description text DEFAULT '',
  reference_number text DEFAULT '',
  period text DEFAULT '',
  is_reversed boolean DEFAULT false,
  reversal_of uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create contract_modifications table
CREATE TABLE IF NOT EXISTS contract_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  modification_date date NOT NULL DEFAULT CURRENT_DATE,
  modification_type text NOT NULL DEFAULT 'payment_change',
  reason text DEFAULT '',
  old_monthly_payment decimal(15,2) DEFAULT 0,
  new_monthly_payment decimal(15,2) DEFAULT 0,
  old_lease_term integer DEFAULT 0,
  new_lease_term integer DEFAULT 0,
  old_discount_rate decimal(5,4) DEFAULT 0,
  new_discount_rate decimal(5,4) DEFAULT 0,
  old_rou_asset decimal(15,2) DEFAULT 0,
  new_rou_asset decimal(15,2) DEFAULT 0,
  old_lease_liability decimal(15,2) DEFAULT 0,
  new_lease_liability decimal(15,2) DEFAULT 0,
  accounting_treatment text DEFAULT '',
  remeasurement_required boolean DEFAULT true,
  notes text DEFAULT '',
  approved_by text DEFAULT '',
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create contract_cancellations table
CREATE TABLE IF NOT EXISTS contract_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  cancellation_date date NOT NULL DEFAULT CURRENT_DATE,
  cancellation_reason text DEFAULT '',
  early_termination boolean DEFAULT false,
  termination_penalty decimal(15,2) DEFAULT 0,
  remaining_rou_asset decimal(15,2) DEFAULT 0,
  remaining_lease_liability decimal(15,2) DEFAULT 0,
  gain_loss_amount decimal(15,2) DEFAULT 0,
  final_payment_amount decimal(15,2) DEFAULT 0,
  settlement_details text DEFAULT '',
  approved_by text DEFAULT '',
  status text DEFAULT 'draft',
  derecognition_posted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create accounting_periods table
CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period text NOT NULL DEFAULT '',
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text DEFAULT 'open',
  total_debits decimal(15,2) DEFAULT 0,
  total_credits decimal(15,2) DEFAULT 0,
  closed_by text DEFAULT '',
  closed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, period)
);

-- Enable RLS on all tables
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

-- RLS Policies for transactions
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for contract_modifications
CREATE POLICY "Users can view own modifications"
  ON contract_modifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own modifications"
  ON contract_modifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own modifications"
  ON contract_modifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own modifications"
  ON contract_modifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for contract_cancellations
CREATE POLICY "Users can view own cancellations"
  ON contract_cancellations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cancellations"
  ON contract_cancellations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cancellations"
  ON contract_cancellations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own cancellations"
  ON contract_cancellations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for accounting_periods
CREATE POLICY "Users can view own periods"
  ON accounting_periods FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own periods"
  ON accounting_periods FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own periods"
  ON accounting_periods FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own periods"
  ON accounting_periods FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_transactions_updated_at') THEN
    CREATE TRIGGER update_transactions_updated_at
      BEFORE UPDATE ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contract_modifications_updated_at') THEN
    CREATE TRIGGER update_contract_modifications_updated_at
      BEFORE UPDATE ON contract_modifications
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contract_cancellations_updated_at') THEN
    CREATE TRIGGER update_contract_cancellations_updated_at
      BEFORE UPDATE ON contract_cancellations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_lease_id ON transactions(lease_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_period ON transactions(period);

CREATE INDEX IF NOT EXISTS idx_modifications_user_id ON contract_modifications(user_id);
CREATE INDEX IF NOT EXISTS idx_modifications_lease_id ON contract_modifications(lease_id);
CREATE INDEX IF NOT EXISTS idx_modifications_date ON contract_modifications(modification_date DESC);
CREATE INDEX IF NOT EXISTS idx_modifications_status ON contract_modifications(status);

CREATE INDEX IF NOT EXISTS idx_cancellations_user_id ON contract_cancellations(user_id);
CREATE INDEX IF NOT EXISTS idx_cancellations_lease_id ON contract_cancellations(lease_id);
CREATE INDEX IF NOT EXISTS idx_cancellations_date ON contract_cancellations(cancellation_date DESC);
CREATE INDEX IF NOT EXISTS idx_cancellations_status ON contract_cancellations(status);

CREATE INDEX IF NOT EXISTS idx_periods_user_id ON accounting_periods(user_id);
CREATE INDEX IF NOT EXISTS idx_periods_period ON accounting_periods(period);
CREATE INDEX IF NOT EXISTS idx_periods_status ON accounting_periods(status);
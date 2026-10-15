/*
  # Lease Accounting Schema for ASC 842

  1. New Tables
    - `leases`
      - Core lease information including lease term, payments, discount rate
      - Classification (Operating vs Finance lease)
      - ROU asset and lease liability calculations
      - Status tracking (Active, Terminated, etc.)
    
    - `lease_payments`
      - Payment schedule for each lease
      - Tracks payment date, amount, and type
    
    - `amortization_schedules`
      - Monthly amortization calculations
      - Interest expense, principal reduction
      - ROU asset depreciation
      - Lease liability balance tracking
    
    - `journal_entries`
      - Accounting entries for lease transactions
      - Debit/credit entries for each period
      - Links to amortization schedule

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their organization's leases
    
  3. Important Notes
    - All monetary values stored as numeric for precision
    - Dates stored as date type for accurate period calculations
    - Classification automatically determined based on ASC 842 criteria
    - Incremental borrowing rate used for discount calculations
*/

-- Create leases table
CREATE TABLE IF NOT EXISTS leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  lease_name text NOT NULL,
  lease_description text DEFAULT '',
  lessor_name text NOT NULL,
  lease_start_date date NOT NULL,
  lease_end_date date NOT NULL,
  lease_term_months integer NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  payment_frequency text NOT NULL DEFAULT 'monthly',
  incremental_borrowing_rate numeric(5,4) NOT NULL,
  lease_classification text NOT NULL DEFAULT 'operating',
  initial_direct_costs numeric(15,2) DEFAULT 0,
  prepaid_amounts numeric(15,2) DEFAULT 0,
  lease_incentives numeric(15,2) DEFAULT 0,
  rou_asset numeric(15,2),
  lease_liability numeric(15,2),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create lease payments table
CREATE TABLE IF NOT EXISTS lease_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  payment_date date NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  payment_type text NOT NULL DEFAULT 'base_rent',
  created_at timestamptz DEFAULT now()
);

-- Create amortization schedules table
CREATE TABLE IF NOT EXISTS amortization_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  period_number integer NOT NULL,
  period_date date NOT NULL,
  beginning_liability numeric(15,2) NOT NULL,
  payment_amount numeric(15,2) NOT NULL,
  interest_expense numeric(15,2) NOT NULL,
  principal_reduction numeric(15,2) NOT NULL,
  ending_liability numeric(15,2) NOT NULL,
  rou_asset_balance numeric(15,2) NOT NULL,
  depreciation_expense numeric(15,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create journal entries table
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  amortization_id uuid REFERENCES amortization_schedules(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  entry_type text NOT NULL,
  account_name text NOT NULL,
  debit_amount numeric(15,2) DEFAULT 0,
  credit_amount numeric(15,2) DEFAULT 0,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE amortization_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leases table
CREATE POLICY "Users can view own leases"
  ON leases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own leases"
  ON leases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own leases"
  ON leases FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own leases"
  ON leases FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for lease_payments table
CREATE POLICY "Users can view payments for own leases"
  ON lease_payments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_payments.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert payments for own leases"
  ON lease_payments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_payments.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can update payments for own leases"
  ON lease_payments FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_payments.lease_id AND leases.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_payments.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete payments for own leases"
  ON lease_payments FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_payments.lease_id AND leases.user_id = auth.uid()
  ));

-- RLS Policies for amortization_schedules table
CREATE POLICY "Users can view schedules for own leases"
  ON amortization_schedules FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = amortization_schedules.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert schedules for own leases"
  ON amortization_schedules FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = amortization_schedules.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can update schedules for own leases"
  ON amortization_schedules FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = amortization_schedules.lease_id AND leases.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = amortization_schedules.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete schedules for own leases"
  ON amortization_schedules FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = amortization_schedules.lease_id AND leases.user_id = auth.uid()
  ));

-- RLS Policies for journal_entries table
CREATE POLICY "Users can view entries for own leases"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = journal_entries.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert entries for own leases"
  ON journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = journal_entries.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can update entries for own leases"
  ON journal_entries FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = journal_entries.lease_id AND leases.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = journal_entries.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete entries for own leases"
  ON journal_entries FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = journal_entries.lease_id AND leases.user_id = auth.uid()
  ));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_leases_user_id ON leases(user_id);
CREATE INDEX IF NOT EXISTS idx_lease_payments_lease_id ON lease_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_amortization_schedules_lease_id ON amortization_schedules(lease_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_lease_id ON journal_entries(lease_id);
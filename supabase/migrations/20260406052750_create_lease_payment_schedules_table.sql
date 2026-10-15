/*
  # Create Lease Payment Schedules Table

  ## Purpose
  Supports variable payment amounts during the lease lifecycle.
  Instead of a single flat payment for the entire term, a lease can have
  multiple payment tranches — each covering a range of months with its own amount.

  ## New Tables
  - `lease_payment_schedules`
    - `id` (uuid, primary key)
    - `lease_id` (uuid, FK → leases)
    - `from_month` (integer) — 1-based starting period number (inclusive)
    - `to_month` (integer) — 1-based ending period number (inclusive)
    - `payment_amount` (numeric) — payment amount for this tranche
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - SELECT / INSERT / UPDATE / DELETE restricted to the authenticated owner
    via a join to the leases table
*/

CREATE TABLE IF NOT EXISTS lease_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  from_month integer NOT NULL CHECK (from_month >= 1),
  to_month integer NOT NULL CHECK (to_month >= from_month),
  payment_amount numeric(15,2) NOT NULL CHECK (payment_amount >= 0),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lease_payment_schedules_lease_id
  ON lease_payment_schedules(lease_id);

ALTER TABLE lease_payment_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view payment schedules"
  ON lease_payment_schedules FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_payment_schedules.lease_id
        AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can insert payment schedules"
  ON lease_payment_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_payment_schedules.lease_id
        AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can update payment schedules"
  ON lease_payment_schedules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_payment_schedules.lease_id
        AND leases.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_payment_schedules.lease_id
        AND leases.user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can delete payment schedules"
  ON lease_payment_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leases
      WHERE leases.id = lease_payment_schedules.lease_id
        AND leases.user_id = auth.uid()
    )
  );

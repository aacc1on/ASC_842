/*
  # Add Lease Modifications Table

  1. New Tables
    - `lease_modifications`
      - Tracks all changes made to leases over time
      - Records modification type, date, and old/new values
      - Provides audit trail for compliance
  
  2. Security
    - Enable RLS on lease_modifications table
    - Add policies for users to manage modifications for their own leases
  
  3. Important Notes
    - All modifications are tracked for ASC 842 compliance
    - Modification types include: payment change, term extension, rate adjustment, etc.
    - Old and new values stored as text for flexibility
*/

-- Create lease_modifications table
CREATE TABLE IF NOT EXISTS lease_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  modification_date date NOT NULL,
  modification_type text NOT NULL,
  description text NOT NULL,
  old_value text DEFAULT '',
  new_value text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE lease_modifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lease_modifications table
CREATE POLICY "Users can view modifications for own leases"
  ON lease_modifications FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_modifications.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert modifications for own leases"
  ON lease_modifications FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_modifications.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can update modifications for own leases"
  ON lease_modifications FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_modifications.lease_id AND leases.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_modifications.lease_id AND leases.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete modifications for own leases"
  ON lease_modifications FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leases WHERE leases.id = lease_modifications.lease_id AND leases.user_id = auth.uid()
  ));

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_lease_modifications_lease_id ON lease_modifications(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_modifications_date ON lease_modifications(modification_date);
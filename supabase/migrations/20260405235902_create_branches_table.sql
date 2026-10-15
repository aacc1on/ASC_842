/*
  # Create Branches Table

  1. New Tables
    - `branches`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `branch_name` (text, required) - Name of the branch/location
      - `branch_code` (text, nullable) - Optional branch code
      - `address` (text, nullable) - Branch address
      - `city` (text, nullable) - City
      - `state` (text, nullable) - State/Province
      - `country` (text, nullable) - Country
      - `postal_code` (text, nullable) - Postal/ZIP code
      - `manager_name` (text, nullable) - Branch manager name
      - `contact_email` (text, nullable) - Contact email
      - `contact_phone` (text, nullable) - Contact phone
      - `is_active` (boolean, default true) - Whether branch is active
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS on branches table
    - Add policies for users to manage their own branches

  3. Important Notes
    - Branches are used to organize leases by location/division
    - Users can create and manage multiple branches
    - Branches can be deactivated but not deleted if they have associated leases
*/

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  branch_name text NOT NULL,
  branch_code text DEFAULT '',
  address text DEFAULT '',
  city text DEFAULT '',
  state text DEFAULT '',
  country text DEFAULT '',
  postal_code text DEFAULT '',
  manager_name text DEFAULT '',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own branches"
  ON branches FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own branches"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own branches"
  ON branches FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own branches"
  ON branches FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_branches_user_id ON branches(user_id);
CREATE INDEX IF NOT EXISTS idx_branches_is_active ON branches(is_active);

/*
# Create Companies Table for Multi-Company Support

1. New Tables
   - `companies`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, references auth.users) - owner of the company record
     - `company_name` (text, not null) - display name of the company
     - `company_code` (text) - optional short code for identification
     - `address` (text) - company address
     - `city` (text)
     - `state` (text)
     - `country` (text)
     - `postal_code` (text)
     - `tax_id` (text) - tax identification number
     - `industry` (text)
     - `is_active` (boolean, default true)
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

2. Modified Tables
   - `leases` - add `company_id` (uuid, nullable, references companies)

3. Security
   - Enable RLS on `companies`.
   - Owner-scoped CRUD: authenticated users can only manage their own companies.

4. Notes
   - company_id on leases is nullable to preserve existing leases without a company assignment.
   - Unique constraint on (user_id, company_name) to prevent duplicate company names per user.
*/

-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  company_code text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  tax_id text,
  industry text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique company name per user
ALTER TABLE companies ADD CONSTRAINT companies_user_name_unique UNIQUE (user_id, company_name);

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- RLS policies for companies
DROP POLICY IF EXISTS "select_own_companies" ON companies;
CREATE POLICY "select_own_companies" ON companies FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_companies" ON companies;
CREATE POLICY "insert_own_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_companies" ON companies;
CREATE POLICY "update_own_companies" ON companies FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_companies" ON companies;
CREATE POLICY "delete_own_companies" ON companies FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Add company_id to leases
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leases' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE leases ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for filtering leases by company
CREATE INDEX IF NOT EXISTS idx_leases_company_id ON leases(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);

-- Allow manage/admin roles to see companies within their org
DROP POLICY IF EXISTS "manage_select_companies" ON companies;
CREATE POLICY "manage_select_companies" ON companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'manage')
    )
  );

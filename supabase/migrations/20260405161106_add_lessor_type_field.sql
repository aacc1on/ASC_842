/*
  # Add Lessor Type Field

  1. Changes
    - Add `lessor_type` column to `leases` table to categorize lessors
    - Supported types: 'corporate', 'individual', 'government', 'financial_institution', 'other'
    - Set default value to 'corporate' for existing records
  
  2. Purpose
    - Enable filtering and organization of leases by lessor type
    - Support better lease portfolio management and reporting
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'lessor_type'
  ) THEN
    ALTER TABLE leases ADD COLUMN lessor_type text DEFAULT 'corporate' NOT NULL;
    
    -- Add check constraint for valid lessor types
    ALTER TABLE leases ADD CONSTRAINT leases_lessor_type_check 
      CHECK (lessor_type IN ('corporate', 'individual', 'government', 'financial_institution', 'other'));
  END IF;
END $$;
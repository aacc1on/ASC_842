/*
  # Add Branch ID to Leases Table

  1. Changes
    - Add `branch_id` column to leases table
    - Foreign key reference to branches table
    - Nullable to allow existing leases without branches

  2. Important Notes
    - Existing leases will have NULL branch_id
    - New leases can be associated with a branch
    - Branch association is optional but recommended for organization
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'branch_id'
  ) THEN
    ALTER TABLE leases ADD COLUMN branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_leases_branch_id ON leases(branch_id);
  END IF;
END $$;

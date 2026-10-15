/*
  # Fix database quality issues

  1. Constraints
    - Add unique constraint on `month_end_documents(user_id, period)` to prevent duplicate period postings
  
  2. Triggers
    - Add `updated_at` trigger on `leases` table (was missing while other tables had it)
  
  3. Indexes
    - Drop unused `idx_amortization_lease_period_date` index (0 scans, redundant with `idx_amortization_lease_date_period`)
  
  4. Notes
    - The unique constraint prevents the same user from posting month-end documents for the same period twice
    - The updated_at trigger keeps the leases.updated_at column accurate on any row update
    - Dropping the unused index saves ~3.3MB storage and removes write overhead
*/

-- 1. Add unique constraint on month_end_documents to prevent duplicate period postings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'month_end_documents_user_period_unique'
  ) THEN
    ALTER TABLE month_end_documents
      ADD CONSTRAINT month_end_documents_user_period_unique UNIQUE (user_id, period);
  END IF;
END $$;

-- 2. Add updated_at trigger on leases table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'update_leases_updated_at'
    AND event_object_table = 'leases'
  ) THEN
    CREATE TRIGGER update_leases_updated_at
      BEFORE UPDATE ON leases
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 3. Drop unused redundant index
DROP INDEX IF EXISTS idx_amortization_lease_period_date;

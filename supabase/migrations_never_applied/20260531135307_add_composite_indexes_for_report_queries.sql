/*
  # Add composite index for transaction date range queries by lease

  1. Problem
    - The ReportsView queries transactions by lease_id + transaction_date range + month_end_document_id
    - Current separate indexes require multiple index scans
  
  2. Fix
    - Add composite index on (lease_id, transaction_date) for efficient range queries per lease
    - This covers the most common report query pattern
*/

CREATE INDEX IF NOT EXISTS idx_transactions_lease_date 
  ON transactions (lease_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_lease_transactions_lease_date 
  ON lease_transactions (lease_id, transaction_date);
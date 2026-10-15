/*
  # Add Performance Indexes for Query Optimization

  ## Summary
  Adds composite and targeted indexes to bring common query patterns into the
  100–150 ms range by eliminating sequential scans on filtered/sorted columns.

  ## New Indexes

  1. amortization_schedules
     - (lease_id, period_date DESC) — supports date-capped queries used by
       calculateCurrentBalances and batchCalculateCurrentBalances
     - (lease_id, period_date, period_number) — supports batch report queries
       filtered by date range

  2. leases
     - (user_id, lease_name text_pattern_ops) — speeds up ilike search on
       lease_name in Dashboard search
     - (user_id, lessor_name text_pattern_ops) — speeds up ilike search on
       lessor_name

  3. contract_modifications
     - (lease_id, status, modification_date DESC) — covers the common
       lease_id + status='approved' + ordering pattern

  4. transactions
     - (user_id, transaction_type, transaction_date DESC) — covers type-filtered
       queries in TransactionsView

  5. documents
     - (user_id, created_at DESC) — covers user document list ordered by date

  6. branches
     - (user_id, is_active, branch_name) — covers active branch list ordered
       by name

  ## Notes
  - All indexes use IF NOT EXISTS to be idempotent
  - text_pattern_ops enables prefix-match and ilike acceleration via btree
*/

CREATE INDEX IF NOT EXISTS idx_amortization_lease_period_date
  ON amortization_schedules (lease_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_amortization_lease_date_period
  ON amortization_schedules (lease_id, period_date, period_number);

CREATE INDEX IF NOT EXISTS idx_leases_user_lease_name
  ON leases (user_id, lease_name text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_leases_user_lessor_name
  ON leases (user_id, lessor_name text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_modifications_lease_status_date
  ON contract_modifications (lease_id, status, modification_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date
  ON transactions (user_id, transaction_type, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_documents_user_created_at
  ON documents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_branches_user_active_name
  ON branches (user_id, is_active, branch_name);

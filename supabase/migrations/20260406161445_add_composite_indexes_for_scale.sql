/*
  # Add Composite Indexes for Scale

  ## Purpose
  Adds composite (multi-column) indexes to support efficient server-side pagination,
  filtering, and search queries at 1000+ leases per user.

  ## New Indexes

  ### leases table
  - `idx_leases_user_created` — speeds up the default ordered list (user_id + created_at DESC)
  - `idx_leases_user_classification` — speeds up filter by lease type per user
  - `idx_leases_user_lessor_type` — speeds up filter by lessor type per user
  - `idx_leases_user_status` — speeds up active lease count aggregation

  ### amortization_schedules table
  - `idx_amortization_lease_period` — speeds up the batch balance calculation
    (fetches all schedules for a set of lease IDs ordered by period)

  ### transactions table
  - `idx_transactions_user_date_desc` — speeds up paginated transaction list per user
  - `idx_transactions_user_period` — speeds up period filter queries

  ### contract_modifications table
  - `idx_modifications_lease_status` — speeds up the approved-mods batch lookup

  ## Notes
  - All indexes use IF NOT EXISTS to be safe on re-run
  - Indexes are non-blocking (standard CREATE INDEX, not CONCURRENT, because migrations
    run outside active prod traffic in this setup)
*/

CREATE INDEX IF NOT EXISTS idx_leases_user_created
  ON leases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leases_user_classification
  ON leases (user_id, lease_classification);

CREATE INDEX IF NOT EXISTS idx_leases_user_lessor_type
  ON leases (user_id, lessor_type);

CREATE INDEX IF NOT EXISTS idx_leases_user_status
  ON leases (user_id, status);

CREATE INDEX IF NOT EXISTS idx_amortization_lease_period
  ON amortization_schedules (lease_id, period_number ASC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date_desc
  ON transactions (user_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_period
  ON transactions (user_id, period);

CREATE INDEX IF NOT EXISTS idx_modifications_lease_status
  ON contract_modifications (lease_id, status);

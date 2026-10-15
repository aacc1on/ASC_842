/*
  # Add Missing Foreign Key Indexes

  ## Problem
  Four foreign key columns lack covering indexes. Postgres must do a sequential
  scan of the child table whenever the parent row is updated or deleted (to find
  and enforce the FK constraint). This is especially costly for large tables.

  ## New Indexes
  - `idx_journal_entries_amortization_id` — covers journal_entries.amortization_id FK
  - `idx_lease_transactions_modification_id` — covers lease_transactions.modification_id FK
  - `idx_lease_transactions_user_id` — covers lease_transactions.user_id FK
  - `idx_transactions_reversal_of` — covers transactions.reversal_of self-referential FK
*/

CREATE INDEX IF NOT EXISTS idx_journal_entries_amortization_id
  ON journal_entries(amortization_id)
  WHERE amortization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lease_transactions_modification_id
  ON lease_transactions(modification_id)
  WHERE modification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lease_transactions_user_id
  ON lease_transactions(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_reversal_of
  ON transactions(reversal_of)
  WHERE reversal_of IS NOT NULL;

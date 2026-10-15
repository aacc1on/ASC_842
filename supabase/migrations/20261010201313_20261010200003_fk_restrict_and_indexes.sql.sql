/*
# FK ON DELETE RESTRICT for organization_id columns + missing indexes

## Item 3: FK ON DELETE RESTRICT
All organization_id → organizations FKs that used SET NULL are changed to RESTRICT.
An organization cannot be deleted while it has any data — SET NULL would silently
orphan rows, breaking org isolation.

documents.lease_id: kept as SET NULL because documents are standalone records that
can exist without a lease (uploaded against a policy election or standalone). If the
lease is deleted, the document remains but loses its lease association. This is a
deliberate "keep the document, lose the link" decision.

accounting_periods.organization_id: changed to RESTRICT (can't delete org with periods).
leases.branch_id / fixed_asset_type_id: kept SET NULL (branch/FAT deletion orphans the
  field gracefully — the lease still exists, just loses the optional association).
leases.policy_election_id FKs: kept SET NULL (election deletion orphans FK gracefully).
leases.company_id: kept SET NULL (company deletion leaves lease intact, loses link).
lease_transactions.modification_id: kept SET NULL (mod deletion leaves transaction).
transactions.reversal_of: kept SET NULL (reversal chain broken gracefully).
subscriptions.organization_id: changed to RESTRICT (org can't vanish while subscribed).
user_profiles.organization_id: changed to RESTRICT (user profiles tied to org).

## Item 4: Missing indexes
From performance advisor: 8 unindexed FKs.
*/

-- ── ITEM 3: Change organization_id SET NULL → RESTRICT ─────────────

-- accounting_periods
ALTER TABLE accounting_periods
  DROP CONSTRAINT IF EXISTS accounting_periods_organization_id_fkey;
ALTER TABLE accounting_periods
  ADD CONSTRAINT accounting_periods_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- amortization_schedules
ALTER TABLE amortization_schedules
  DROP CONSTRAINT IF EXISTS amortization_schedules_organization_id_fkey;
ALTER TABLE amortization_schedules
  ADD CONSTRAINT amortization_schedules_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- branches
ALTER TABLE branches
  DROP CONSTRAINT IF EXISTS branches_organization_id_fkey;
ALTER TABLE branches
  ADD CONSTRAINT branches_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- contract_cancellations
ALTER TABLE contract_cancellations
  DROP CONSTRAINT IF EXISTS contract_cancellations_organization_id_fkey;
ALTER TABLE contract_cancellations
  ADD CONSTRAINT contract_cancellations_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- contract_modifications
ALTER TABLE contract_modifications
  DROP CONSTRAINT IF EXISTS contract_modifications_organization_id_fkey;
ALTER TABLE contract_modifications
  ADD CONSTRAINT contract_modifications_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- documents
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_organization_id_fkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- error_logs
ALTER TABLE error_logs
  DROP CONSTRAINT IF EXISTS error_logs_organization_id_fkey;
ALTER TABLE error_logs
  ADD CONSTRAINT error_logs_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- fixed_asset_types
ALTER TABLE fixed_asset_types
  DROP CONSTRAINT IF EXISTS fixed_asset_types_organization_id_fkey;
ALTER TABLE fixed_asset_types
  ADD CONSTRAINT fixed_asset_types_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- journal_entries
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_organization_id_fkey;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- lease_modifications
ALTER TABLE lease_modifications
  DROP CONSTRAINT IF EXISTS lease_modifications_organization_id_fkey;
ALTER TABLE lease_modifications
  ADD CONSTRAINT lease_modifications_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- lease_payment_schedules
ALTER TABLE lease_payment_schedules
  DROP CONSTRAINT IF EXISTS lease_payment_schedules_organization_id_fkey;
ALTER TABLE lease_payment_schedules
  ADD CONSTRAINT lease_payment_schedules_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- lease_payments
ALTER TABLE lease_payments
  DROP CONSTRAINT IF EXISTS lease_payments_organization_id_fkey;
ALTER TABLE lease_payments
  ADD CONSTRAINT lease_payments_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- lease_transactions
ALTER TABLE lease_transactions
  DROP CONSTRAINT IF EXISTS lease_transactions_organization_id_fkey;
ALTER TABLE lease_transactions
  ADD CONSTRAINT lease_transactions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- leases
ALTER TABLE leases
  DROP CONSTRAINT IF EXISTS leases_organization_id_fkey;
ALTER TABLE leases
  ADD CONSTRAINT leases_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- month_end_documents
ALTER TABLE month_end_documents
  DROP CONSTRAINT IF EXISTS month_end_documents_organization_id_fkey;
ALTER TABLE month_end_documents
  ADD CONSTRAINT month_end_documents_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- subscriptions
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_organization_id_fkey;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- transactions
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_organization_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- user_activity_logs
ALTER TABLE user_activity_logs
  DROP CONSTRAINT IF EXISTS user_activity_logs_organization_id_fkey;
ALTER TABLE user_activity_logs
  ADD CONSTRAINT user_activity_logs_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- user_profiles
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_organization_id_fkey;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- lessors: already CASCADE → keep CASCADE (lessor is owned by org)

-- ── ITEM 4: Missing FK indexes ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounting_policy_elections_company_id
  ON accounting_policy_elections(company_id);

CREATE INDEX IF NOT EXISTS idx_accounting_policy_elections_fixed_asset_type_id
  ON accounting_policy_elections(fixed_asset_type_id);

CREATE INDEX IF NOT EXISTS idx_accounting_policy_elections_supporting_document_id
  ON accounting_policy_elections(supporting_document_id);

CREATE INDEX IF NOT EXISTS idx_amortization_schedules_lease_id
  ON amortization_schedules(lease_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_organization_id
  ON audit_log(organization_id);

CREATE INDEX IF NOT EXISTS idx_error_logs_organization_id
  ON error_logs(organization_id);

CREATE INDEX IF NOT EXISTS idx_lease_impairments_organization_id
  ON lease_impairments(organization_id);

CREATE INDEX IF NOT EXISTS idx_leases_short_term_policy_election_id
  ON leases(short_term_policy_election_id);

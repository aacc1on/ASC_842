/*
  # Drop Genuinely Unused Indexes

  ## Decision Criteria
  Indexes reported as unused by the Supabase advisor were evaluated case by case.
  The following were dropped because they are either:
  - Superseded by a composite index that covers the same leading column
  - For tables/columns that the application never filters or sorts by independently
  - Narrow single-column indexes where the composite version already provides coverage

  ## Retained (not dropped)
  The following "unused" indexes were intentionally kept because they support
  scale/pagination queries that will be used as data grows:
  - idx_leases_user_created          (paginated lease list, default sort)
  - idx_leases_user_classification   (classification filter)
  - idx_leases_user_lessor_type      (lessor type filter)
  - idx_leases_user_status           (active count aggregation)
  - idx_leases_branch_id             (branch-scoped lease list)
  - idx_amortization_lease_period    (batch balance calculation)
  - idx_transactions_user_date_desc  (paginated transaction list)
  - idx_transactions_user_period     (period filter queries)
  - idx_modifications_lease_status   (approved-mods lookup)
  - idx_transactions_month_end_doc   (month-end document lookup)
  - idx_month_end_documents_user_period (period uniqueness check)

  ## Dropped
  - idx_periods_period               — superseded by unique constraint (user_id, period)
  - idx_periods_status               — accounting_periods table is tiny; no filtering benefit
  - idx_periods_user_id              — superseded by composite idx_leases_user_created logic; table is tiny
  - idx_lease_modifications_date     — lease_modifications is a small audit table; date alone rarely filtered
  - idx_user_activity_logs_created_at — rarely queried directly; app does not paginate activity logs
  - idx_documents_category           — low-cardinality column; seq scan is cheaper
  - idx_documents_created_at         — no pagination on documents currently; can be re-added if needed
  - idx_transactions_type            — superseded by composite idx_transactions_user_date_desc
  - idx_modifications_date           — superseded by composite idx_modifications_lease_status
  - idx_cancellations_date           — cancellations table is very small
  - idx_cancellations_status         — cancellations table is very small
  - idx_branches_is_active           — boolean index on a small table; not beneficial
*/

DROP INDEX IF EXISTS idx_periods_period;
DROP INDEX IF EXISTS idx_periods_status;
DROP INDEX IF EXISTS idx_periods_user_id;
DROP INDEX IF EXISTS idx_lease_modifications_date;
DROP INDEX IF EXISTS idx_user_activity_logs_created_at;
DROP INDEX IF EXISTS idx_documents_category;
DROP INDEX IF EXISTS idx_documents_created_at;
DROP INDEX IF EXISTS idx_transactions_type;
DROP INDEX IF EXISTS idx_modifications_date;
DROP INDEX IF EXISTS idx_cancellations_date;
DROP INDEX IF EXISTS idx_cancellations_status;
DROP INDEX IF EXISTS idx_branches_is_active;

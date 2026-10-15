-- Drop 4 single-column indexes that are fully covered by composite indexes
-- and have never been used according to the performance advisor.
-- idx_leases_user_id is covered by idx_leases_user_created, idx_leases_user_classification, etc.
-- idx_amortization_schedules_lease_id is covered by idx_amortization_lease_date_period, idx_amortization_lease_period
-- idx_documents_user_id is covered by idx_documents_user_created_at
-- idx_branches_user_id is covered by idx_branches_user_active_name

DROP INDEX IF EXISTS public.idx_leases_user_id;
DROP INDEX IF EXISTS public.idx_amortization_schedules_lease_id;
DROP INDEX IF EXISTS public.idx_documents_user_id;
DROP INDEX IF EXISTS public.idx_branches_user_id;

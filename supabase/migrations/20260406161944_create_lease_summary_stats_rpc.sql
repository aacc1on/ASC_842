/*
  # Create get_lease_summary_stats RPC function

  ## Purpose
  Replaces a client-side aggregation that previously fetched all lease rows
  just to compute 3 summary numbers. This function runs the aggregation in
  the database and returns a single row.

  ## Returns
  - total_rou (numeric) — sum of rou_asset across all leases for the current user
  - total_liability (numeric) — sum of lease_liability across all leases
  - active_count (bigint) — count of leases with status = 'active'

  ## Security
  SECURITY DEFINER is NOT used — the function runs as the calling user so RLS
  on the leases table applies automatically. Only the current user's leases
  are aggregated.
*/

CREATE OR REPLACE FUNCTION get_lease_summary_stats()
RETURNS TABLE (
  total_rou       numeric,
  total_liability numeric,
  active_count    bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(rou_asset), 0)       AS total_rou,
    COALESCE(SUM(lease_liability), 0) AS total_liability,
    COUNT(*) FILTER (WHERE status = 'active') AS active_count
  FROM leases
  WHERE user_id = auth.uid();
$$;

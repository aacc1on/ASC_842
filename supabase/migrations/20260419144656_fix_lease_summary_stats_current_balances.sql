/*
  # Fix Lease Summary Stats to Return Current Balances

  ## Summary
  The dashboard summary cards (Total ROU Assets, Total Liabilities) previously
  summed the inception values of ROU assets and lease liabilities from the
  `leases` table. However, the individual lease cards displayed current
  balances computed from the `amortization_schedules` table (reflecting
  depreciation, principal reductions, etc.), causing totals to not match
  the sum of what users see per lease.

  ## Changes
  1. Replace `get_lease_summary_stats()` function
     - Aggregates current ROU asset and current lease liability using the
       latest amortization schedule row with `period_date <= CURRENT_DATE`
     - Falls back to inception values when:
         a. The lease has approved contract modifications (mirroring the
            client-side logic which trusts the stored columns in that case)
         b. The lease has not started yet
         c. No amortization schedule rows are available
     - Active count unchanged

  ## Security
  - Function remains STABLE with locked-down search_path
  - Filters strictly by `auth.uid()` so users only see their own totals
*/

CREATE OR REPLACE FUNCTION public.get_lease_summary_stats()
RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
WITH user_leases AS (
  SELECT l.id, l.rou_asset, l.lease_liability, l.lease_start_date, l.status
  FROM public.leases l
  WHERE l.user_id = (select auth.uid())
),
leases_with_mods AS (
  SELECT DISTINCT cm.lease_id
  FROM public.contract_modifications cm
  WHERE cm.status = 'approved'
    AND cm.lease_id IN (SELECT id FROM user_leases)
),
latest_schedule AS (
  SELECT DISTINCT ON (s.lease_id)
    s.lease_id,
    s.rou_asset_balance,
    s.ending_liability
  FROM public.amortization_schedules s
  WHERE s.lease_id IN (SELECT id FROM user_leases)
    AND s.period_date <= CURRENT_DATE
  ORDER BY s.lease_id, s.period_number DESC
),
current_balances AS (
  SELECT
    l.status,
    CASE
      WHEN l.rou_asset IS NULL OR l.lease_liability IS NULL THEN 0
      WHEN l.id IN (SELECT lease_id FROM leases_with_mods) THEN COALESCE(l.rou_asset, 0)
      WHEN l.lease_start_date > CURRENT_DATE THEN COALESCE(l.rou_asset, 0)
      WHEN ls.rou_asset_balance IS NOT NULL THEN GREATEST(ls.rou_asset_balance, 0)
      ELSE COALESCE(l.rou_asset, 0)
    END AS current_rou,
    CASE
      WHEN l.rou_asset IS NULL OR l.lease_liability IS NULL THEN 0
      WHEN l.id IN (SELECT lease_id FROM leases_with_mods) THEN COALESCE(l.lease_liability, 0)
      WHEN l.lease_start_date > CURRENT_DATE THEN COALESCE(l.lease_liability, 0)
      WHEN ls.ending_liability IS NOT NULL THEN GREATEST(ls.ending_liability, 0)
      ELSE COALESCE(l.lease_liability, 0)
    END AS current_liability
  FROM user_leases l
  LEFT JOIN latest_schedule ls ON ls.lease_id = l.id
)
SELECT
  COALESCE(SUM(current_rou), 0) AS total_rou,
  COALESCE(SUM(current_liability), 0) AS total_liability,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count
FROM current_balances;
$function$;

/*
  Fix get_lease_summary_stats to match has_data_access pattern (admin/manage only).
  View users see stats for their own leases via the user_id = auth.uid() check.
*/

DROP FUNCTION IF EXISTS public.get_lease_summary_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL)
RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
  ) AS has_access
),
latest_schedule AS (
  SELECT DISTINCT ON (a.lease_id)
    a.lease_id,
    a.rou_asset_balance,
    a.ending_liability
  FROM amortization_schedules a
  INNER JOIN leases l ON l.id = a.lease_id
  CROSS JOIN user_has_data_access uda
  WHERE a.period_date <= CURRENT_DATE
    AND (uda.has_access OR l.user_id = auth.uid())
    AND (p_company_id IS NULL OR l.company_id = p_company_id)
  ORDER BY a.lease_id, a.period_number DESC
)
SELECT
  COALESCE(SUM(
    CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.rou_asset_balance, 0)
    ELSE COALESCE(l.rou_asset, 0)
    END
  ), 0) AS total_rou,
  COALESCE(SUM(
    CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.ending_liability, 0)
    ELSE COALESCE(l.lease_liability, 0)
    END
  ), 0) AS total_liability,
  COUNT(*) FILTER (WHERE l.status = 'active') AS active_count
FROM leases l
LEFT JOIN latest_schedule ls ON ls.lease_id = l.id
CROSS JOIN user_has_data_access uda
WHERE (uda.has_access OR l.user_id = auth.uid())
  AND (p_company_id IS NULL OR l.company_id = p_company_id);
$function$;

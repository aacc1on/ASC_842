/*
  # Fix mutable search_path on get_lease_summary_stats

  1. Security
    - Sets an immutable search_path on the function to prevent search_path hijacking
    - Pins search_path to 'public, auth' so the function cannot be tricked into
      resolving objects from an attacker-controlled schema

  2. Notes
    - Function logic is unchanged
    - Only the SET search_path attribute is added
*/

CREATE OR REPLACE FUNCTION public.get_lease_summary_stats()
  RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
  LANGUAGE sql
  STABLE
  SET search_path = 'public', 'auth'
AS $function$
WITH latest_schedule AS (
  SELECT DISTINCT ON (a.lease_id)
    a.lease_id,
    a.rou_asset_balance,
    a.ending_liability
  FROM amortization_schedules a
  INNER JOIN leases l ON l.id = a.lease_id AND l.user_id = auth.uid()
  WHERE a.period_date <= CURRENT_DATE
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
WHERE l.user_id = auth.uid();
$function$;

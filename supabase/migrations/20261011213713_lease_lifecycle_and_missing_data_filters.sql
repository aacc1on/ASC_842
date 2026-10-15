/*
# Lease lifecycle status + missing classification data filters

1. Changes
- `get_lease_summary_stats`: `active_count` now counts leases with status 'active' whose term includes the
  as-of date (start <= as_of <= end). Leases not yet started or already ended are no longer counted as active.
- `get_lease_portfolio_totals`: two new optional filters
  - `p_status`: 'active' | 'not_started' | 'ended' (NULL = all)
  - `p_missing_classification`: when true, only recognized Finance leases missing asset fair value or economic life
  The previous signature is replaced (same name, extra defaulted parameters).

2. Security
- Same access rules as before (org isolation + admin/manage or own leases). EXECUTE granted to authenticated only.

3. Important notes
- No data is modified.
*/

CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
      AND organization_id = internal.current_org_id()
  ) AS has_access
)
SELECT
  COALESCE(SUM(b.rou), 0),
  COALESCE(SUM(b.liability), 0),
  COUNT(*) FILTER (
    WHERE l.status = 'active'
      AND l.lease_start_date <= COALESCE(p_as_of, CURRENT_DATE)
      AND l.lease_end_date >= COALESCE(p_as_of, CURRENT_DATE)
  )
FROM leases l
CROSS JOIN user_has_data_access uda
LEFT JOIN LATERAL internal.lease_balance_as_of(l.id, COALESCE(p_as_of, CURRENT_DATE)) b ON true
WHERE (uda.has_access OR l.user_id = auth.uid())
  AND l.organization_id = internal.current_org_id()
  AND (p_company_id IS NULL OR l.company_id = p_company_id);
$function$;

DROP FUNCTION IF EXISTS public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date);

CREATE FUNCTION public.get_lease_portfolio_totals(
  p_company_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_lease_type text DEFAULT NULL::text,
  p_lessor_type text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_branch_unassigned boolean DEFAULT false,
  p_as_of date DEFAULT CURRENT_DATE,
  p_status text DEFAULT NULL::text,
  p_missing_classification boolean DEFAULT false
)
RETURNS TABLE(bucket text, lease_count bigint, total_rou numeric, total_liability numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
      AND organization_id = internal.current_org_id()
  ) AS has_access
),
filtered AS (
  SELECT l.*
  FROM leases l
  CROSS JOIN user_has_data_access uda
  WHERE (uda.has_access OR l.user_id = auth.uid())
    AND l.organization_id = internal.current_org_id()
    AND (p_company_id IS NULL OR l.company_id = p_company_id)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR l.lease_name ILIKE '%' || btrim(p_search) || '%'
      OR l.lessor_name ILIKE '%' || btrim(p_search) || '%'
    )
    AND (p_lease_type IS NULL OR l.lease_classification = p_lease_type)
    AND (p_lessor_type IS NULL OR l.lessor_type = p_lessor_type)
    AND (
      CASE
        WHEN p_branch_unassigned THEN l.branch_id IS NULL
        WHEN p_branch_id IS NOT NULL THEN l.branch_id = p_branch_id
        ELSE true
      END
    )
    AND (
      CASE p_status
        WHEN 'active' THEN l.status = 'active'
          AND l.lease_start_date <= COALESCE(p_as_of, CURRENT_DATE)
          AND l.lease_end_date >= COALESCE(p_as_of, CURRENT_DATE)
        WHEN 'not_started' THEN l.status = 'active'
          AND l.lease_start_date > COALESCE(p_as_of, CURRENT_DATE)
        WHEN 'ended' THEN l.status <> 'active'
          OR l.lease_end_date < COALESCE(p_as_of, CURRENT_DATE)
        ELSE true
      END
    )
    AND (
      NOT COALESCE(p_missing_classification, false)
      OR (
        l.lease_classification = 'finance'
        AND COALESCE(l.accounting_treatment, 'recognized') <> 'short_term_exemption'
        AND (COALESCE(l.asset_market_value, 0) <= 0 OR COALESCE(l.asset_economic_life_years, 0) <= 0)
      )
    )
)
SELECT
  CASE
    WHEN f.accounting_treatment = 'short_term_exemption' THEN 'short_term'
    WHEN f.lease_classification = 'finance' THEN 'finance'
    ELSE 'operating'
  END AS bucket,
  COUNT(*)::bigint AS lease_count,
  COALESCE(SUM(b.rou), 0) AS total_rou,
  COALESCE(SUM(b.liability), 0) AS total_liability
FROM filtered f
LEFT JOIN LATERAL internal.lease_balance_as_of(f.id, COALESCE(p_as_of, CURRENT_DATE)) b ON true
GROUP BY 1;
$function$;

REVOKE ALL ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date, text, boolean) TO authenticated;
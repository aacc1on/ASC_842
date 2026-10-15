/*
# Lease Portfolio filtered totals

1. Purpose
- The Lease Portfolio board columns (Finance / Operating) and the table view
  previously summed only the leases loaded on the current page.
- This adds a read-only function that returns, for ALL leases matching the
  page filters, the lease count and current ROU asset / lease liability totals
  per bucket (finance, operating, short_term).

2. New Functions
- `public.get_lease_portfolio_totals(p_company_id, p_search, p_lease_type,
  p_lessor_type, p_branch_id, p_branch_unassigned)`
  - Returns one row per bucket: `bucket` text, `lease_count` bigint,
    `total_rou` numeric, `total_liability` numeric.
  - Balance logic is identical to `get_lease_summary_stats` (latest
    amortization row on or before today, floored at 0; otherwise the lease's
    recorded ROU / liability). With no filters, the bucket totals sum exactly
    to the top "Total ROU Assets" / "Total Lease Liability" cards.

3. Security
- SECURITY INVOKER (row level security on leases / amortization_schedules
  still applies), restricted to the caller's organization and to the same
  access rule as the summary cards (admin/manage see org data, others see
  their own leases).
- EXECUTE granted to authenticated only; revoked from public and anon.

4. Notes
1. No tables, columns or data are changed.
2. No existing calculation is modified.
*/

CREATE OR REPLACE FUNCTION public.get_lease_portfolio_totals(
  p_company_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_lease_type text DEFAULT NULL,
  p_lessor_type text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_branch_unassigned boolean DEFAULT false
)
RETURNS TABLE(bucket text, lease_count bigint, total_rou numeric, total_liability numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
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
),
latest_schedule AS (
  SELECT DISTINCT ON (a.lease_id) a.lease_id, a.rou_asset_balance, a.ending_liability
  FROM amortization_schedules a
  INNER JOIN filtered f ON f.id = a.lease_id
  WHERE a.period_date <= CURRENT_DATE
  ORDER BY a.lease_id, a.period_number DESC
)
SELECT
  CASE
    WHEN f.accounting_treatment = 'short_term_exemption' THEN 'short_term'
    WHEN f.lease_classification = 'finance' THEN 'finance'
    ELSE 'operating'
  END AS bucket,
  COUNT(*)::bigint AS lease_count,
  COALESCE(SUM(CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.rou_asset_balance, 0) ELSE COALESCE(f.rou_asset, 0) END), 0) AS total_rou,
  COALESCE(SUM(CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.ending_liability, 0) ELSE COALESCE(f.lease_liability, 0) END), 0) AS total_liability
FROM filtered f
LEFT JOIN latest_schedule ls ON ls.lease_id = f.id
GROUP BY 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean) TO authenticated;

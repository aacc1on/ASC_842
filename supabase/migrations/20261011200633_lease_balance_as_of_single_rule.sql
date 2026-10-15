/*
# One "balance as of date" rule for every lease balance

1. New function
- `internal.lease_balance_as_of(p_lease_id uuid, p_as_of date)` returns one row
  (rou numeric, liability numeric, status text) computed ONLY from the lease's
  amortization schedule (never from the stored leases.rou_asset / lease_liability).
  - status 'not_started': p_as_of < lease_start_date -> 0 / 0 (excluded from totals)
  - status 'ended': p_as_of >= lease_end_date, or every schedule period has completed -> 0 / 0
  - status 'active': otherwise
    * A period (period_date = 1st of month) is "completed" when the last day of its month <= p_as_of.
    * ROU and interest are recognised through the last completed period end (no partial-month accrual).
      ROU = rou_asset_balance of the last completed period, or the opening ROU
      (period 1 rou_asset_balance + depreciation_expense) if none completed yet.
    * Liability: a payment reduces the liability on its payment date.
      beginning timing = 1st day of the period, end timing = LAST day of the period.
      In the current (not completed) period: beginning timing -> beginning_liability - payment_amount,
      end timing -> beginning_liability. Otherwise ending_liability of the last completed period.

2. Modified functions (dropped and recreated with an extra optional p_as_of date DEFAULT CURRENT_DATE)
- `public.get_lease_summary_stats(p_company_id, p_as_of)`
- `public.get_lease_portfolio_totals(p_company_id, p_search, p_lease_type, p_lessor_type, p_branch_id, p_branch_unassigned, p_as_of)`
  Both now sum internal.lease_balance_as_of. lease_count / active_count exclude not-started leases
  from balances but keep counts as before. Same access rule as before (admin/manage in current org or owner).

3. Security
- SECURITY INVOKER everywhere, so RLS on leases / amortization_schedules still applies.
- EXECUTE granted to authenticated only; revoked from PUBLIC and anon.
*/

CREATE OR REPLACE FUNCTION internal.lease_balance_as_of(p_lease_id uuid, p_as_of date)
RETURNS TABLE(rou numeric, liability numeric, status text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'internal'
AS $$
DECLARE
  v_start date;
  v_end date;
  v_beginning boolean;
  v_done amortization_schedules%ROWTYPE;
  v_cur amortization_schedules%ROWTYPE;
  v_first amortization_schedules%ROWTYPE;
  v_max int;
BEGIN
  SELECT l.lease_start_date, l.lease_end_date, COALESCE(l.payment_timing, 'end') = 'beginning'
    INTO v_start, v_end, v_beginning
  FROM leases l WHERE l.id = p_lease_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_as_of < v_start THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 'not_started'::text; RETURN;
  END IF;
  IF v_end IS NOT NULL AND p_as_of >= v_end THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 'ended'::text; RETURN;
  END IF;

  SELECT max(a.period_number) INTO v_max FROM amortization_schedules a WHERE a.lease_id = p_lease_id;
  IF v_max IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 'no_schedule'::text; RETURN;
  END IF;

  SELECT * INTO v_first FROM amortization_schedules a
   WHERE a.lease_id = p_lease_id ORDER BY a.period_number ASC LIMIT 1;

  SELECT * INTO v_done FROM amortization_schedules a
   WHERE a.lease_id = p_lease_id
     AND (date_trunc('month', a.period_date) + interval '1 month - 1 day')::date <= p_as_of
   ORDER BY a.period_number DESC LIMIT 1;

  IF v_done.id IS NOT NULL AND v_done.period_number >= v_max THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 'ended'::text; RETURN;
  END IF;

  SELECT * INTO v_cur FROM amortization_schedules a
   WHERE a.lease_id = p_lease_id
     AND a.period_date <= p_as_of
     AND (date_trunc('month', a.period_date) + interval '1 month - 1 day')::date > p_as_of
   ORDER BY a.period_number ASC LIMIT 1;

  RETURN QUERY SELECT
    COALESCE(v_done.rou_asset_balance, v_first.rou_asset_balance + v_first.depreciation_expense),
    CASE
      WHEN v_cur.id IS NOT NULL AND v_beginning THEN v_cur.beginning_liability - v_cur.payment_amount
      WHEN v_cur.id IS NOT NULL THEN v_cur.beginning_liability
      WHEN v_done.id IS NOT NULL THEN v_done.ending_liability
      ELSE v_first.beginning_liability
    END,
    'active'::text;
END;
$$;

REVOKE ALL ON FUNCTION internal.lease_balance_as_of(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.lease_balance_as_of(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION internal.lease_balance_as_of(uuid, date) TO authenticated;

DROP FUNCTION IF EXISTS public.get_lease_summary_stats(uuid);
CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'auth'
AS $$
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
  COUNT(*) FILTER (WHERE l.status = 'active')
FROM leases l
CROSS JOIN user_has_data_access uda
LEFT JOIN LATERAL internal.lease_balance_as_of(l.id, COALESCE(p_as_of, CURRENT_DATE)) b ON true
WHERE (uda.has_access OR l.user_id = auth.uid())
  AND l.organization_id = internal.current_org_id()
  AND (p_company_id IS NULL OR l.company_id = p_company_id);
$$;

REVOKE ALL ON FUNCTION public.get_lease_summary_stats(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lease_summary_stats(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_lease_summary_stats(uuid, date) TO authenticated;

DROP FUNCTION IF EXISTS public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean);
CREATE OR REPLACE FUNCTION public.get_lease_portfolio_totals(
  p_company_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_lease_type text DEFAULT NULL,
  p_lessor_type text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_branch_unassigned boolean DEFAULT false,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE(bucket text, lease_count bigint, total_rou numeric, total_liability numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'auth'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_lease_portfolio_totals(uuid, text, text, text, uuid, boolean, date) TO authenticated;

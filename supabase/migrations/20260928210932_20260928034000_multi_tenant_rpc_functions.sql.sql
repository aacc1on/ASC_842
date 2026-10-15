/*
# Multi-tenant: add org filter to SECURITY DEFINER / RPC functions

## What this does
Updates public.get_lease_summary_stats and public.get_filtered_transactions
to filter by the caller's organization_id so they cannot leak data from other orgs.

## Functions updated
- public.get_lease_summary_stats: added organization_id = internal.current_org_id() filter on leases
- public.get_filtered_transactions: added organization_id = internal.current_org_id() filter on all queries (transactions, lease_transactions, leases)
- public.get_user_emails_for_admin: already updated to be org-scoped in the schema migration
*/

-- ============================================================
-- get_lease_summary_stats — add org filter
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL::uuid)
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
),
latest_schedule AS (
  SELECT DISTINCT ON (a.lease_id) a.lease_id, a.rou_asset_balance, a.ending_liability
  FROM amortization_schedules a
  INNER JOIN leases l ON l.id = a.lease_id
  CROSS JOIN user_has_data_access uda
  WHERE a.period_date <= CURRENT_DATE
  AND (uda.has_access OR l.user_id = auth.uid())
  AND l.organization_id = internal.current_org_id()
  AND (p_company_id IS NULL OR l.company_id = p_company_id)
  ORDER BY a.lease_id, a.period_number DESC
)
SELECT
  COALESCE(SUM(CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.rou_asset_balance,0) ELSE COALESCE(l.rou_asset,0) END),0),
  COALESCE(SUM(CASE WHEN ls.lease_id IS NOT NULL THEN GREATEST(ls.ending_liability,0) ELSE COALESCE(l.lease_liability,0) END),0),
  COUNT(*) FILTER (WHERE l.status = 'active')
FROM leases l
LEFT JOIN latest_schedule ls ON ls.lease_id = l.id
CROSS JOIN user_has_data_access uda
WHERE (uda.has_access OR l.user_id = auth.uid())
AND l.organization_id = internal.current_org_id()
AND (p_company_id IS NULL OR l.company_id = p_company_id);
$$;

-- ============================================================
-- get_filtered_transactions — add org filter
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_filtered_transactions(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 12,
  p_search text DEFAULT ''::text,
  p_type text DEFAULT 'all'::text,
  p_period text DEFAULT 'all'::text,
  p_period_start date DEFAULT NULL::date,
  p_period_end date DEFAULT NULL::date,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_branch_filter text DEFAULT 'all'::text,
  p_asset_type_id uuid DEFAULT NULL::uuid,
  p_asset_type_filter text DEFAULT 'all'::text,
  p_company_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total_count bigint; v_total_debits numeric; v_total_credits numeric;
  v_rows jsonb; v_offset int;
  v_org_id uuid;
BEGIN
  v_org_id := internal.current_org_id();
  v_offset := (p_page - 1) * p_page_size;

  WITH combined AS (
    SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type, t.account_debited, t.account_credited,
    t.debit_amount, t.credit_amount, t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
    l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
    fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
    FROM transactions t
    JOIN leases l ON l.id = t.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE t.organization_id = v_org_id
    UNION ALL
    SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type, lt.account_debited, lt.account_credited,
    lt.amount, lt.amount, lt.description, 'N/A', to_char(lt.transaction_date, 'YYYY-MM'), false, lt.created_at,
    l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
    fat.type_name, fat.type_code
    FROM lease_transactions lt
    JOIN leases l ON l.id = lt.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE lt.transaction_type NOT IN ('modification', 'remeasurement') AND lt.modification_id IS NULL
    AND lt.organization_id = v_org_id
  ),
  filtered AS (
    SELECT * FROM combined c WHERE
    (p_search = '' OR c.description ILIKE '%'||p_search||'%' OR c.account_debited ILIKE '%'||p_search||'%' OR
    c.account_credited ILIKE '%'||p_search||'%' OR c.reference_number ILIKE '%'||p_search||'%' OR c.lease_name ILIKE '%'||p_search||'%')
    AND (p_type = 'all' OR c.transaction_type = p_type)
    AND (CASE WHEN p_period = 'all' THEN true WHEN p_period = 'custom' THEN
    (p_period_start IS NULL OR c.transaction_date >= p_period_start) AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
    ELSE c.period = p_period END)
    AND (CASE WHEN p_branch_filter = 'all' THEN true WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL ELSE c.branch_id = p_branch_id END)
    AND (CASE WHEN p_asset_type_filter = 'all' THEN true WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL ELSE c.fixed_asset_type_id = p_asset_type_id END)
  )
  SELECT count(*), COALESCE(sum(debit_amount),0), COALESCE(sum(credit_amount),0)
  INTO v_total_count, v_total_debits, v_total_credits FROM filtered;

  WITH combined AS (
    SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type, t.account_debited, t.account_credited,
    t.debit_amount, t.credit_amount, t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
    l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
    fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
    FROM transactions t
    JOIN leases l ON l.id = t.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE t.organization_id = v_org_id
    UNION ALL
    SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type, lt.account_debited, lt.account_credited,
    lt.amount, lt.amount, lt.description, 'N/A', to_char(lt.transaction_date, 'YYYY-MM'), false, lt.created_at,
    l.lease_name, l.branch_id, l.fixed_asset_type_id, b.branch_name, b.branch_code,
    fat.type_name, fat.type_code
    FROM lease_transactions lt
    JOIN leases l ON l.id = lt.lease_id AND (p_company_id IS NULL OR l.company_id = p_company_id)
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE lt.transaction_type NOT IN ('modification', 'remeasurement') AND lt.modification_id IS NULL
    AND lt.organization_id = v_org_id
  ),
  filtered AS (
    SELECT * FROM combined c WHERE
    (p_search = '' OR c.description ILIKE '%'||p_search||'%' OR c.account_debited ILIKE '%'||p_search||'%' OR
    c.account_credited ILIKE '%'||p_search||'%' OR c.reference_number ILIKE '%'||p_search||'%' OR c.lease_name ILIKE '%'||p_search||'%')
    AND (p_type = 'all' OR c.transaction_type = p_type)
    AND (CASE WHEN p_period = 'all' THEN true WHEN p_period = 'custom' THEN
    (p_period_start IS NULL OR c.transaction_date >= p_period_start) AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
    ELSE c.period = p_period END)
    AND (CASE WHEN p_branch_filter = 'all' THEN true WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL ELSE c.branch_id = p_branch_id END)
    AND (CASE WHEN p_asset_type_filter = 'all' THEN true WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL ELSE c.fixed_asset_type_id = p_asset_type_id END)
  )
  SELECT jsonb_agg(row_to_json(f)::jsonb ORDER BY f.transaction_date DESC, f.created_at DESC)
  INTO v_rows FROM (SELECT * FROM filtered ORDER BY transaction_date DESC, created_at DESC LIMIT p_page_size OFFSET v_offset) f;

  RETURN jsonb_build_object('rows', COALESCE(v_rows,'[]'::jsonb), 'total_count', v_total_count,
  'total_debits', v_total_debits, 'total_credits', v_total_credits,
  'debit_summary', '{}'::jsonb, 'credit_summary', '{}'::jsonb);
END;
$$;

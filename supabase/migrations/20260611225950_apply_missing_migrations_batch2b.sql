
-- Batch 2b: companies table, company_id on leases, RPCs with company filter

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  company_code text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  tax_id text,
  industry text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_name)
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_companies" ON companies FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_companies" ON companies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_companies" ON companies FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_companies" ON companies FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "manage_select_companies" ON companies FOR SELECT TO authenticated USING (internal.has_data_access());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leases' AND column_name = 'company_id') THEN
    ALTER TABLE leases ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leases_company_id ON leases(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);

-- get_filtered_transactions
CREATE OR REPLACE FUNCTION public.get_filtered_transactions(
  p_page int DEFAULT 1, p_page_size int DEFAULT 12, p_search text DEFAULT '',
  p_type text DEFAULT 'all', p_period text DEFAULT 'all',
  p_period_start date DEFAULT NULL, p_period_end date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL, p_branch_filter text DEFAULT 'all',
  p_asset_type_id uuid DEFAULT NULL, p_asset_type_filter text DEFAULT 'all',
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_total_count bigint; v_total_debits numeric; v_total_credits numeric;
  v_rows jsonb; v_offset int;
BEGIN
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

-- get_lease_summary_stats with company filter
DROP FUNCTION IF EXISTS public.get_lease_summary_stats();
DROP FUNCTION IF EXISTS public.get_lease_summary_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_lease_summary_stats(p_company_id uuid DEFAULT NULL)
RETURNS TABLE(total_rou numeric, total_liability numeric, active_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public', 'auth'
AS $function$
WITH user_has_data_access AS (
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role IN ('admin', 'manage')) AS has_access
),
latest_schedule AS (
  SELECT DISTINCT ON (a.lease_id) a.lease_id, a.rou_asset_balance, a.ending_liability
  FROM amortization_schedules a
  INNER JOIN leases l ON l.id = a.lease_id
  CROSS JOIN user_has_data_access uda
  WHERE a.period_date <= CURRENT_DATE
    AND (uda.has_access OR l.user_id = auth.uid())
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
  AND (p_company_id IS NULL OR l.company_id = p_company_id);
$function$;

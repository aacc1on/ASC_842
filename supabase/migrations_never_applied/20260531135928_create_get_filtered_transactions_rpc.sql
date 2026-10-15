/*
  # Create server-side paginated transactions RPC

  1. New Functions
    - `get_filtered_transactions` - Returns paginated, filtered transactions from both
      `transactions` and `lease_transactions` tables combined
    - Accepts search, type, period, branch, asset type filters
    - Returns paginated rows plus total count and aggregate totals
    - Performs filtering and sorting server-side for performance

  2. Performance
    - Eliminates need to load all transactions into browser memory
    - Uses existing indexes on transaction_date, lease_id, transaction_type
    - Single round-trip replaces multiple paginated fetches

  3. Security
    - SECURITY INVOKER so RLS policies are respected
    - search_path set to prevent schema injection
*/

CREATE OR REPLACE FUNCTION public.get_filtered_transactions(
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 12,
  p_search text DEFAULT '',
  p_type text DEFAULT 'all',
  p_period text DEFAULT 'all',
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_branch_filter text DEFAULT 'all',
  p_asset_type_id uuid DEFAULT NULL,
  p_asset_type_filter text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_total_debits numeric;
  v_total_credits numeric;
  v_rows jsonb;
  v_offset int;
  v_debit_summary jsonb;
  v_credit_summary jsonb;
BEGIN
  v_offset := (p_page - 1) * p_page_size;

  WITH combined AS (
    -- From transactions table (month-end and manual entries)
    SELECT
      t.id,
      t.lease_id,
      t.transaction_date,
      t.transaction_type,
      t.account_debited,
      t.account_credited,
      t.debit_amount,
      t.credit_amount,
      t.description,
      t.reference_number,
      t.period,
      t.is_reversed,
      t.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM transactions t
    JOIN leases l ON l.id = t.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id

    UNION ALL

    -- From lease_transactions table (initial recognition, modifications, etc.)
    SELECT
      lt.id,
      lt.lease_id,
      lt.transaction_date,
      lt.transaction_type,
      lt.account_debited,
      lt.account_credited,
      lt.amount AS debit_amount,
      lt.amount AS credit_amount,
      lt.description,
      'N/A' AS reference_number,
      to_char(lt.transaction_date, 'YYYY-MM') AS period,
      false AS is_reversed,
      lt.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM lease_transactions lt
    JOIN leases l ON l.id = lt.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE lt.transaction_type NOT IN ('modification', 'remeasurement')
      AND lt.modification_id IS NULL
  ),
  filtered AS (
    SELECT *
    FROM combined c
    WHERE
      -- Search filter
      (p_search = '' OR
        c.description ILIKE '%' || p_search || '%' OR
        c.account_debited ILIKE '%' || p_search || '%' OR
        c.account_credited ILIKE '%' || p_search || '%' OR
        c.reference_number ILIKE '%' || p_search || '%' OR
        c.lease_name ILIKE '%' || p_search || '%')
      -- Type filter
      AND (p_type = 'all' OR c.transaction_type = p_type)
      -- Period filter
      AND (
        CASE
          WHEN p_period = 'all' THEN true
          WHEN p_period = 'custom' THEN
            (p_period_start IS NULL OR c.transaction_date >= p_period_start)
            AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
          ELSE c.period = p_period
        END
      )
      -- Branch filter
      AND (
        CASE
          WHEN p_branch_filter = 'all' THEN true
          WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
          ELSE c.branch_id = p_branch_id
        END
      )
      -- Asset type filter
      AND (
        CASE
          WHEN p_asset_type_filter = 'all' THEN true
          WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
          ELSE c.fixed_asset_type_id = p_asset_type_id
        END
      )
  )
  SELECT
    count(*),
    COALESCE(sum(debit_amount), 0),
    COALESCE(sum(credit_amount), 0)
  INTO v_total_count, v_total_debits, v_total_credits
  FROM filtered;

  -- Get paginated rows
  WITH combined AS (
    SELECT
      t.id,
      t.lease_id,
      t.transaction_date,
      t.transaction_type,
      t.account_debited,
      t.account_credited,
      t.debit_amount,
      t.credit_amount,
      t.description,
      t.reference_number,
      t.period,
      t.is_reversed,
      t.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM transactions t
    JOIN leases l ON l.id = t.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id

    UNION ALL

    SELECT
      lt.id,
      lt.lease_id,
      lt.transaction_date,
      lt.transaction_type,
      lt.account_debited,
      lt.account_credited,
      lt.amount AS debit_amount,
      lt.amount AS credit_amount,
      lt.description,
      'N/A' AS reference_number,
      to_char(lt.transaction_date, 'YYYY-MM') AS period,
      false AS is_reversed,
      lt.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM lease_transactions lt
    JOIN leases l ON l.id = lt.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE lt.transaction_type NOT IN ('modification', 'remeasurement')
      AND lt.modification_id IS NULL
  ),
  filtered AS (
    SELECT *
    FROM combined c
    WHERE
      (p_search = '' OR
        c.description ILIKE '%' || p_search || '%' OR
        c.account_debited ILIKE '%' || p_search || '%' OR
        c.account_credited ILIKE '%' || p_search || '%' OR
        c.reference_number ILIKE '%' || p_search || '%' OR
        c.lease_name ILIKE '%' || p_search || '%')
      AND (p_type = 'all' OR c.transaction_type = p_type)
      AND (
        CASE
          WHEN p_period = 'all' THEN true
          WHEN p_period = 'custom' THEN
            (p_period_start IS NULL OR c.transaction_date >= p_period_start)
            AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
          ELSE c.period = p_period
        END
      )
      AND (
        CASE
          WHEN p_branch_filter = 'all' THEN true
          WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
          ELSE c.branch_id = p_branch_id
        END
      )
      AND (
        CASE
          WHEN p_asset_type_filter = 'all' THEN true
          WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
          ELSE c.fixed_asset_type_id = p_asset_type_id
        END
      )
  )
  SELECT jsonb_agg(row_to_json(f)::jsonb ORDER BY f.transaction_date DESC, f.created_at DESC)
  INTO v_rows
  FROM (
    SELECT * FROM filtered
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) f;

  -- Get account summaries (debit and credit breakdowns)
  WITH combined AS (
    SELECT
      t.id,
      t.lease_id,
      t.transaction_date,
      t.transaction_type,
      t.account_debited,
      t.account_credited,
      t.debit_amount,
      t.credit_amount,
      t.description,
      t.reference_number,
      t.period,
      t.is_reversed,
      t.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM transactions t
    JOIN leases l ON l.id = t.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id

    UNION ALL

    SELECT
      lt.id,
      lt.lease_id,
      lt.transaction_date,
      lt.transaction_type,
      lt.account_debited,
      lt.account_credited,
      lt.amount AS debit_amount,
      lt.amount AS credit_amount,
      lt.description,
      'N/A' AS reference_number,
      to_char(lt.transaction_date, 'YYYY-MM') AS period,
      false AS is_reversed,
      lt.created_at,
      l.lease_name,
      l.branch_id,
      l.fixed_asset_type_id,
      b.branch_name,
      b.branch_code,
      fat.type_name AS fixed_asset_type_name,
      fat.type_code AS fixed_asset_type_code
    FROM lease_transactions lt
    JOIN leases l ON l.id = lt.lease_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
    WHERE lt.transaction_type NOT IN ('modification', 'remeasurement')
      AND lt.modification_id IS NULL
  ),
  filtered AS (
    SELECT *
    FROM combined c
    WHERE
      (p_search = '' OR
        c.description ILIKE '%' || p_search || '%' OR
        c.account_debited ILIKE '%' || p_search || '%' OR
        c.account_credited ILIKE '%' || p_search || '%' OR
        c.reference_number ILIKE '%' || p_search || '%' OR
        c.lease_name ILIKE '%' || p_search || '%')
      AND (p_type = 'all' OR c.transaction_type = p_type)
      AND (
        CASE
          WHEN p_period = 'all' THEN true
          WHEN p_period = 'custom' THEN
            (p_period_start IS NULL OR c.transaction_date >= p_period_start)
            AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
          ELSE c.period = p_period
        END
      )
      AND (
        CASE
          WHEN p_branch_filter = 'all' THEN true
          WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
          ELSE c.branch_id = p_branch_id
        END
      )
      AND (
        CASE
          WHEN p_asset_type_filter = 'all' THEN true
          WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
          ELSE c.fixed_asset_type_id = p_asset_type_id
        END
      )
  )
  SELECT
    COALESCE(jsonb_object_agg(d.account_debited, d.total) FILTER (WHERE d.account_debited IS NOT NULL), '{}'::jsonb),
    COALESCE(jsonb_object_agg(cr.account_credited, cr.total) FILTER (WHERE cr.account_credited IS NOT NULL), '{}'::jsonb)
  INTO v_debit_summary, v_credit_summary
  FROM
    (SELECT account_debited, sum(debit_amount) AS total FROM filtered WHERE debit_amount > 0 GROUP BY account_debited) d
  FULL OUTER JOIN
    (SELECT account_credited, sum(credit_amount) AS total FROM filtered WHERE credit_amount > 0 GROUP BY account_credited) cr
  ON false;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'total_debits', v_total_debits,
    'total_credits', v_total_credits,
    'debit_summary', COALESCE(v_debit_summary, '{}'::jsonb),
    'credit_summary', COALESCE(v_credit_summary, '{}'::jsonb)
  );
END;
$$;
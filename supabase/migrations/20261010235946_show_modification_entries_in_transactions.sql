/*
# Show lease modification entries in the transactions list

1. Modified Functions
- `get_filtered_transactions` (13-argument version used by the app) no longer
  excludes `lease_transactions` rows of type `modification` / `remeasurement`
  or rows linked to a modification. Remeasurement entries are only written to
  `lease_transactions`, so excluding them hid them from the Transactions page
  and from debit/credit totals.

2. Security
- Function remains SECURITY INVOKER; RLS and tenant isolation are unchanged.
- No tables, columns, or policies change.
*/

CREATE OR REPLACE FUNCTION public.get_filtered_transactions(p_page integer DEFAULT 1, p_page_size integer DEFAULT 12, p_search text DEFAULT ''::text, p_type text DEFAULT 'all'::text, p_period text DEFAULT 'all'::text, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_branch_id uuid DEFAULT NULL::uuid, p_branch_filter text DEFAULT 'all'::text, p_asset_type_id uuid DEFAULT NULL::uuid, p_asset_type_filter text DEFAULT 'all'::text, p_company_id uuid DEFAULT NULL::uuid, p_lease_classification text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
)
SELECT count(*), COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0)
INTO v_total_count, v_total_debits, v_total_credits
FROM filtered;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
)
SELECT jsonb_agg(row_to_json(f)::jsonb ORDER BY f.transaction_date DESC, f.created_at DESC)
INTO v_rows
FROM (
SELECT * FROM filtered
ORDER BY transaction_date DESC, created_at DESC
LIMIT p_page_size OFFSET v_offset
) f;

WITH combined AS (
SELECT t.id, t.lease_id, t.transaction_date, t.transaction_type,
t.account_debited, t.account_credited, t.debit_amount, t.credit_amount,
t.description, t.reference_number, t.period, t.is_reversed, t.created_at,
l.lease_name, l.branch_id, l.fixed_asset_type_id, l.lease_classification,
b.branch_name, b.branch_code, fat.type_name AS fixed_asset_type_name,
fat.type_code AS fixed_asset_type_code
FROM transactions t
JOIN leases l ON l.id = t.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
UNION ALL
SELECT lt.id, lt.lease_id, lt.transaction_date, lt.transaction_type,
lt.account_debited, lt.account_credited, lt.amount AS debit_amount,
lt.amount AS credit_amount, lt.description, 'N/A' AS reference_number,
to_char(lt.transaction_date, 'YYYY-MM') AS period, false AS is_reversed,
lt.created_at, l.lease_name, l.branch_id, l.fixed_asset_type_id,
l.lease_classification, b.branch_name, b.branch_code,
fat.type_name AS fixed_asset_type_name, fat.type_code AS fixed_asset_type_code
FROM lease_transactions lt
JOIN leases l ON l.id = lt.lease_id
AND (p_company_id IS NULL OR l.company_id = p_company_id)
LEFT JOIN branches b ON b.id = l.branch_id
LEFT JOIN fixed_asset_types fat ON fat.id = l.fixed_asset_type_id
),
filtered AS (
SELECT * FROM combined c
WHERE (p_search = '' OR c.description ILIKE '%' || p_search || '%'
OR c.account_debited ILIKE '%' || p_search || '%'
OR c.account_credited ILIKE '%' || p_search || '%'
OR c.reference_number ILIKE '%' || p_search || '%'
OR c.lease_name ILIKE '%' || p_search || '%')
AND (p_type = 'all' OR c.transaction_type = p_type)
AND CASE
WHEN p_period = 'all' THEN true
WHEN p_period = 'custom' THEN
(p_period_start IS NULL OR c.transaction_date >= p_period_start)
AND (p_period_end IS NULL OR c.transaction_date <= p_period_end)
ELSE c.period = p_period
END
AND CASE
WHEN p_branch_filter = 'all' THEN true
WHEN p_branch_filter = 'none' THEN c.branch_id IS NULL
ELSE c.branch_id = p_branch_id
END
AND CASE
WHEN p_asset_type_filter = 'all' THEN true
WHEN p_asset_type_filter = 'none' THEN c.fixed_asset_type_id IS NULL
ELSE c.fixed_asset_type_id = p_asset_type_id
END
AND (p_lease_classification = 'all' OR c.lease_classification = p_lease_classification)
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
$function$;
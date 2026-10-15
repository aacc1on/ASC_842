/*
# Round C database cleanup (balances, ledger reconciliation, data health, years column)

Runs as one transaction. No business rows are inserted, updated or deleted.

1. Single source for balances (C1)
   - New `public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[] DEFAULT NULL)`.
     Returns per lease: rou, liability, status, current_portion, opening_rou.
     Uses `internal.lease_balance_as_of`, so the app no longer has its own copy of the rule.
     SECURITY DEFINER, fixed search_path, limited to the caller's organization
     (admin/manage see all org leases, other users only their own), authenticated only.

2. Ledger roles and reconciliation (C2)
   - Table comments describe the role of lease_transactions, transactions and journal_entries.
   - New `internal.reconcile_ledgers(p_org, p_from, p_to)` compares, for locked periods only:
     posted month-end transactions vs periodic journal entries, lease events (lease_transactions)
     vs event journal entries, and reports any entry or posted row whose debits and credits differ.
   - New read-only wrapper `public.get_ledger_reconciliation(p_from, p_to)` for admin/manage users.

3. Data health (C3)
   - New `internal.data_health(p_org)` listing data problems.
   - `public.get_data_health()` for org admins (own org) and
     `public.get_platform_data_health()` for platform owners (all orgs).

4. Remove the old years column (C4)
   - Drops trigger `a01_sync_economic_life`, function `internal.sync_economic_life_years()`
     and column `leases.asset_economic_life_years` (an exact mirror of months / 12; nothing reads it).
   - The rules the trigger enforced move to the months column itself:
     default 0 and a check that it is not negative.

## Security
- All new public functions: EXECUTE revoked from PUBLIC and anon, granted to authenticated.
- All new internal functions: EXECUTE revoked from PUBLIC, anon and authenticated.
*/

-- C1 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lease_balances_as_of(p_as_of date, p_lease_ids uuid[] DEFAULT NULL)
RETURNS TABLE(lease_id uuid, rou numeric, liability numeric, status text, current_portion numeric, opening_rou numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
  SELECT
    l.id,
    round(b.rou, 2),
    round(b.liability, 2),
    b.status,
    CASE WHEN b.status = 'active'
      THEN round(least(b.liability, greatest(0, b.liability - COALESCE(n.liability, 0))), 2)
      ELSE 0::numeric END,
    COALESCE(round(f.rou_asset_balance + f.depreciation_expense, 2), 0::numeric)
  FROM public.leases l
  CROSS JOIN LATERAL internal.lease_balance_as_of(l.id, p_as_of) b
  LEFT JOIN LATERAL internal.lease_balance_as_of(l.id, (p_as_of + interval '12 months')::date) n ON true
  LEFT JOIN LATERAL (
    SELECT a.rou_asset_balance, a.depreciation_expense
    FROM public.amortization_schedules a
    WHERE a.lease_id = l.id
    ORDER BY a.period_number ASC
    LIMIT 1
  ) f ON true
  WHERE auth.uid() IS NOT NULL
    AND p_as_of IS NOT NULL
    AND l.organization_id = internal.current_org_id()
    AND (internal.has_data_access() OR l.user_id = auth.uid())
    AND (p_lease_ids IS NULL OR l.id = ANY (p_lease_ids));
$$;

REVOKE ALL ON FUNCTION public.get_lease_balances_as_of(date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lease_balances_as_of(date, uuid[]) TO authenticated;

-- C2 ---------------------------------------------------------------------
COMMENT ON TABLE public.lease_transactions IS
  'Lease events: initial recognition, modification, impairment and termination. One row per event entry. See docs/ledgers.md.';
COMMENT ON TABLE public.transactions IS
  'Posted month-end entries. Written only when a month-end document is posted; never rebuilt. See docs/ledgers.md.';
COMMENT ON TABLE public.journal_entries IS
  'Derived/projected journal entries generated from the amortization schedule and lease events. Rebuilt for months after the last locked month. See docs/ledgers.md.';

CREATE OR REPLACE FUNCTION internal.normalize_account(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$ SELECT btrim(replace(lower(COALESCE(p, '')), 'right-of-use', 'rou')) $$;

CREATE OR REPLACE FUNCTION internal.reconcile_ledgers(p_org uuid, p_from date, p_to date)
RETURNS TABLE(check_type text, lease_id uuid, lease_name text, period text, account text,
              posted numeric, expected numeric, difference numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
  WITH locked AS (
    SELECT ap.period
    FROM public.accounting_periods ap
    WHERE ap.organization_id = p_org
      AND ap.status IN ('locked', 'closed')
      AND ap.period_start >= date_trunc('month', p_from)::date
      AND ap.period_end <= p_to
  ),
  event_types AS (
    SELECT unnest(ARRAY['Initial Recognition', 'Lease Modification', 'Lease Cancellation', 'Lease Impairment', 'Lease Termination']) AS t
  ),
  posted AS (
    SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
      SELECT t.lease_id, t.period, internal.normalize_account(t.account_debited) AS acct, COALESCE(t.debit_amount, 0) AS amt
      FROM public.transactions t
      WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked) AND t.account_debited IS NOT NULL
      UNION ALL
      SELECT t.lease_id, t.period, internal.normalize_account(t.account_credited), -COALESCE(t.credit_amount, 0)
      FROM public.transactions t
      WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked) AND t.account_credited IS NOT NULL
    ) x GROUP BY 1, 2, 3
  ),
  je_periodic AS (
    SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
           sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
    FROM public.journal_entries j
    WHERE j.organization_id = p_org
      AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
      AND j.entry_type NOT IN (SELECT t FROM event_types)
    GROUP BY 1, 2, 3
  ),
  events AS (
    SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
      SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM') AS period, internal.normalize_account(e.account_debited) AS acct, COALESCE(e.amount, 0) AS amt
      FROM public.lease_transactions e
      WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT period FROM locked)
      UNION ALL
      SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM'), internal.normalize_account(e.account_credited), -COALESCE(e.amount, 0)
      FROM public.lease_transactions e
      WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT period FROM locked)
    ) x GROUP BY 1, 2, 3
  ),
  je_events AS (
    SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
           sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
    FROM public.journal_entries j
    WHERE j.organization_id = p_org
      AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
      AND j.entry_type IN (SELECT t FROM event_types)
    GROUP BY 1, 2, 3
  ),
  diffs AS (
    SELECT 'posted_vs_journal'::text AS check_type, COALESCE(p.lease_id, j.lease_id) AS lease_id,
           COALESCE(p.period, j.period) AS period, COALESCE(p.acct, j.acct) AS account,
           round(COALESCE(p.amt, 0), 2) AS posted, round(COALESCE(j.amt, 0), 2) AS expected
    FROM posted p
    FULL JOIN je_periodic j ON j.lease_id IS NOT DISTINCT FROM p.lease_id AND j.period = p.period AND j.acct = p.acct
    UNION ALL
    SELECT 'events_vs_journal', COALESCE(e.lease_id, j.lease_id), COALESCE(e.period, j.period), COALESCE(e.acct, j.acct),
           round(COALESCE(e.amt, 0), 2), round(COALESCE(j.amt, 0), 2)
    FROM events e
    FULL JOIN je_events j ON j.lease_id IS NOT DISTINCT FROM e.lease_id AND j.period = e.period AND j.acct = e.acct
  ),
  unbalanced AS (
    SELECT 'unbalanced_journal_entry'::text AS check_type, j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period,
           j.entry_type AS account,
           round(sum(COALESCE(j.debit_amount, 0)), 2) AS posted, round(sum(COALESCE(j.credit_amount, 0)), 2) AS expected
    FROM public.journal_entries j
    WHERE j.organization_id = p_org AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT period FROM locked)
    GROUP BY j.lease_id, j.entry_date, j.entry_type
    HAVING abs(sum(COALESCE(j.debit_amount, 0)) - sum(COALESCE(j.credit_amount, 0))) > 0.01
    UNION ALL
    SELECT 'unbalanced_posted_entry', t.lease_id, t.period, COALESCE(t.transaction_type, ''),
           round(sum(COALESCE(t.debit_amount, 0)), 2), round(sum(COALESCE(t.credit_amount, 0)), 2)
    FROM public.transactions t
    WHERE t.organization_id = p_org AND t.period IN (SELECT period FROM locked)
    GROUP BY t.lease_id, t.period, t.transaction_type
    HAVING abs(sum(COALESCE(t.debit_amount, 0)) - sum(COALESCE(t.credit_amount, 0))) > 0.01
  )
  SELECT r.check_type, r.lease_id, l.lease_name, r.period, r.account, r.posted, r.expected, round(r.posted - r.expected, 2)
  FROM (
    SELECT * FROM diffs WHERE abs(posted - expected) > 0.01
    UNION ALL
    SELECT * FROM unbalanced
  ) r
  LEFT JOIN public.leases l ON l.id = r.lease_id
  ORDER BY r.period, l.lease_name, r.check_type, r.account;
$$;

REVOKE ALL ON FUNCTION internal.normalize_account(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.reconcile_ledgers(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_ledger_reconciliation(p_from date, p_to date)
RETURNS TABLE(check_type text, lease_id uuid, lease_name text, period text, account text,
              posted numeric, expected numeric, difference numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.has_data_access() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.reconcile_ledgers(internal.current_org_id(), p_from, p_to);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ledger_reconciliation(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(date, date) TO authenticated;

-- C3 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.data_health(p_org uuid)
RETURNS TABLE(organization_id uuid, check_key text, lease_id uuid, lease_name text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
  WITH org_leases AS (
    SELECT l.* FROM public.leases l WHERE l.organization_id = p_org
  ),
  last_rows AS (
    SELECT DISTINCT ON (a.lease_id) a.lease_id, a.ending_liability, a.rou_asset_balance
    FROM public.amortization_schedules a
    JOIN org_leases l ON l.id = a.lease_id
    ORDER BY a.lease_id, a.period_number DESC
  ),
  ir AS (
    SELECT e.lease_id, sum(e.amount) AS amt
    FROM public.lease_transactions e
    WHERE e.organization_id = p_org AND e.transaction_type = 'initial_recognition'
      AND internal.normalize_account(e.account_credited) LIKE '%liabilit%'
    GROUP BY e.lease_id
  ),
  modified AS (
    SELECT DISTINCT e.lease_id FROM public.lease_transactions e
    WHERE e.organization_id = p_org AND e.transaction_type <> 'initial_recognition'
    UNION
    SELECT DISTINCT c.lease_id FROM public.contract_modifications c WHERE c.organization_id = p_org
  )
  SELECT p_org, 'lease_without_schedule', l.id, l.lease_name, 'Lease has no amortization schedule rows'
  FROM org_leases l
  WHERE l.status NOT IN ('draft', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.amortization_schedules a WHERE a.lease_id = l.id)
  UNION ALL
  SELECT p_org, 'schedule_not_ending_at_zero', l.id, l.lease_name,
         format('Last schedule row ends at liability %s / ROU %s', round(r.ending_liability, 2), round(r.rou_asset_balance, 2))
  FROM last_rows r JOIN org_leases l ON l.id = r.lease_id
  WHERE l.status <> 'cancelled'
    AND (abs(COALESCE(r.ending_liability, 0)) > 0.01 OR abs(COALESCE(r.rou_asset_balance, 0)) > 0.01)
  UNION ALL
  SELECT p_org, 'orphan_row', x.lease_id, NULL, format('%s row belongs to a lease in another organization', x.tbl)
  FROM (
    SELECT 'amortization_schedules' AS tbl, c.lease_id FROM public.amortization_schedules c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'journal_entries', c.lease_id FROM public.journal_entries c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'transactions', c.lease_id FROM public.transactions c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'lease_transactions', c.lease_id FROM public.lease_transactions c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'lease_payment_schedules', c.lease_id FROM public.lease_payment_schedules c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'contract_modifications', c.lease_id FROM public.contract_modifications c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL SELECT 'lease_impairments', c.lease_id FROM public.lease_impairments c JOIN public.leases l ON l.id = c.lease_id
      WHERE c.organization_id = p_org AND l.organization_id IS DISTINCT FROM c.organization_id
  ) x
  UNION ALL
  SELECT p_org, 'unbalanced_journal_entry', j.lease_id, l.lease_name,
         format('%s on %s: debits %s, credits %s', j.entry_type, j.entry_date,
                round(sum(COALESCE(j.debit_amount, 0)), 2), round(sum(COALESCE(j.credit_amount, 0)), 2))
  FROM public.journal_entries j LEFT JOIN public.leases l ON l.id = j.lease_id
  WHERE j.organization_id = p_org
  GROUP BY j.lease_id, l.lease_name, j.entry_date, j.entry_type
  HAVING abs(sum(COALESCE(j.debit_amount, 0)) - sum(COALESCE(j.credit_amount, 0))) > 0.01
  UNION ALL
  SELECT p_org, 'finance_lease_missing_inputs', l.id, l.lease_name, 'Finance lease is missing fair value or useful life'
  FROM org_leases l
  WHERE l.lease_classification = 'finance' AND l.status <> 'cancelled'
    AND (NOT (COALESCE(l.asset_market_value, 0) > 0 OR COALESCE(l.asset_fair_value, 0) > 0)
         OR NOT (COALESCE(l.asset_economic_life_months, 0) > 0))
  UNION ALL
  SELECT p_org, 'initial_recognition_mismatch', l.id, l.lease_name,
         format('Initial recognition %s differs from lease liability %s', round(ir.amt, 2), round(l.lease_liability, 2))
  FROM org_leases l JOIN ir ON ir.lease_id = l.id
  WHERE l.id NOT IN (SELECT m.lease_id FROM modified m WHERE m.lease_id IS NOT NULL)
    AND abs(ir.amt - COALESCE(l.lease_liability, 0)) > 0.01
  UNION ALL
  SELECT p_org, 'organization_without_owner', NULL, NULL, format('Organization "%s" has no admin user', o.name)
  FROM public.organizations o
  WHERE o.id = p_org
    AND NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.organization_id = o.id AND u.role = 'admin')
  UNION ALL
  SELECT p_org, 'subscription_without_owner', NULL, NULL, format('Subscription (%s, %s) has no matching user in this organization', s.plan_key, s.status)
  FROM public.subscriptions s
  WHERE s.organization_id = p_org
    AND NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.user_id = s.user_id AND u.organization_id = s.organization_id);
$$;

REVOKE ALL ON FUNCTION internal.data_health(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_data_health()
RETURNS TABLE(organization_id uuid, check_key text, lease_id uuid, lease_name text, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.data_health(internal.current_org_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_data_health()
RETURNS TABLE(organization_id uuid, organization_name text, check_key text, lease_id uuid, lease_name text, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT h.organization_id, o.name, h.check_key, h.lease_id, h.lease_name, h.detail
    FROM public.organizations o
    CROSS JOIN LATERAL internal.data_health(o.id) h
    UNION ALL
    SELECT s.organization_id, NULL::text, 'subscription_without_organization', NULL::uuid, NULL::text,
           format('Subscription (%s, %s) is not linked to an existing organization', s.plan_key, s.status)
    FROM public.subscriptions s
    WHERE s.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations o2 WHERE o2.id = s.organization_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_data_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_data_health() TO authenticated;
REVOKE ALL ON FUNCTION public.get_platform_data_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_data_health() TO authenticated;

-- C4 ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS a01_sync_economic_life ON public.leases;
DROP FUNCTION IF EXISTS internal.sync_economic_life_years();
ALTER TABLE public.leases DROP COLUMN IF EXISTS asset_economic_life_years;
ALTER TABLE public.leases ALTER COLUMN asset_economic_life_months SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_asset_economic_life_months_nonneg') THEN
    ALTER TABLE public.leases
      ADD CONSTRAINT leases_asset_economic_life_months_nonneg CHECK (asset_economic_life_months >= 0);
  END IF;
END $$;

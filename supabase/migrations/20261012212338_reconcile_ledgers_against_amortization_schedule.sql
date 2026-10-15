/*
# Ledger reconciliation against the amortization schedule (source of truth)

## What changes
`internal.reconcile_ledgers` now checks every LOCKED month against the stored amortization schedule,
per lease, month and account, instead of only against projected journal entries (which are not kept
for most locked months).

## Checks returned (same columns as before)
1. `missing_posting` (new): a lease-month inside the lease term (it has a schedule row with amounts) in a
   locked month that has no month-end posting and no catch-up line. One row per lease-month; `expected`
   is the month's total debits (interest + ROU amortization/depreciation + payment).
2. `posted_vs_schedule` (new): for lease-months that are posted, posted month-end amounts per account
   versus the schedule (finance: Interest Expense, Depreciation Expense, Accumulated Depreciation - ROU
   Asset, Lease Liability, Cash; operating: Operating Lease Expense, ROU Asset, Lease Liability, Cash).
3. `posted_vs_journal`, `events_vs_journal`, `unbalanced_journal_entry`, `unbalanced_posted_entry`:
   unchanged in meaning.

## Catch-up corrections
Catch-up rows are attributed to the months they correct (from `month_end_catch_up_lines`), never to the
month they are booked in. Posted catch-up batches always count. Prepared (not yet posted) batches count
only when `p_include_prepared_catch_up` is true, which shows what the ledger will look like once the
catch-up is posted.

## Functions
- `internal.reconcile_ledgers(org, from, to, include_prepared_catch_up)`: new 4-argument version.
- `internal.reconcile_ledgers(org, from, to)`: unchanged signature, calls the new version with false.
- `public.get_ledger_reconciliation(from, to, include_prepared_catch_up)`: new overload for the app; the
  existing 2-argument version is unchanged. Both require a signed-in member with data access.

## Security
Internal functions stay non-executable by clients. The new public overload is granted to
`authenticated` only. No data is changed.
*/

CREATE OR REPLACE FUNCTION internal.reconcile_ledgers(p_org uuid, p_from date, p_to date, p_include_prepared_catch_up boolean)
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
  recognized AS (
    SELECT l.id, l.lease_classification AS cls, l.lease_start_date
    FROM public.leases l
    WHERE l.organization_id = p_org
      AND l.accounting_treatment IS DISTINCT FROM 'short_term_exemption'
  ),
  expected_rows AS (
    SELECT r.id AS lease_id, lk.period, r.cls,
           COALESCE(s.interest_expense, 0) AS i, COALESCE(s.depreciation_expense, 0) AS d, COALESCE(s.payment_amount, 0) AS p
    FROM locked lk
    JOIN recognized r ON date_trunc('month', r.lease_start_date) <= to_date(lk.period, 'YYYY-MM')
    JOIN public.amortization_schedules s ON s.lease_id = r.id
      AND s.period_number = internal.lease_period_number(r.lease_start_date, lk.period)
  ),
  expected AS (
    SELECT e.lease_id, e.period, internal.normalize_account(x.acct) AS acct, sum(x.amt) AS amt
    FROM expected_rows e
    CROSS JOIN LATERAL (VALUES
      (CASE WHEN e.cls = 'operating' THEN 'Operating Lease Expense' ELSE 'Interest Expense' END, e.i),
      ('Lease Liability', e.p - e.i),
      (CASE WHEN e.cls = 'operating' THEN 'Operating Lease Expense' ELSE 'Depreciation Expense' END, e.d),
      (CASE WHEN e.cls = 'operating' THEN 'ROU Asset' ELSE 'Accumulated Depreciation - ROU Asset' END, -e.d),
      ('Cash', -e.p)
    ) AS x(acct, amt)
    GROUP BY 1, 2, 3
  ),
  catch_up AS (
    SELECT c.lease_id, c.missed_period AS period, c.account_debited, c.account_credited, c.amount
    FROM public.month_end_catch_up_lines c
    JOIN public.month_end_catch_up_batches b ON b.id = c.batch_id
    WHERE c.organization_id = p_org
      AND c.missed_period IN (SELECT lk.period FROM locked lk)
      AND (b.status = 'posted' OR p_include_prepared_catch_up)
  ),
  posted AS (
    SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
      SELECT t.lease_id, t.period, internal.normalize_account(t.account_debited) AS acct, COALESCE(t.debit_amount, 0) AS amt
      FROM public.transactions t
      WHERE t.organization_id = p_org AND t.month_end_document_id IS NOT NULL
        AND t.transaction_type <> 'month_end_catch_up'
        AND t.period IN (SELECT lk.period FROM locked lk) AND t.account_debited IS NOT NULL
        AND t.lease_id IN (SELECT r.id FROM recognized r)
      UNION ALL
      SELECT t.lease_id, t.period, internal.normalize_account(t.account_credited), -COALESCE(t.credit_amount, 0)
      FROM public.transactions t
      WHERE t.organization_id = p_org AND t.month_end_document_id IS NOT NULL
        AND t.transaction_type <> 'month_end_catch_up'
        AND t.period IN (SELECT lk.period FROM locked lk) AND t.account_credited IS NOT NULL
        AND t.lease_id IN (SELECT r.id FROM recognized r)
      UNION ALL
      SELECT c.lease_id, c.period, internal.normalize_account(c.account_debited), c.amount FROM catch_up c
      UNION ALL
      SELECT c.lease_id, c.period, internal.normalize_account(c.account_credited), -c.amount FROM catch_up c
    ) x GROUP BY 1, 2, 3
  ),
  covered AS (
    SELECT DISTINCT p.lease_id, p.period FROM posted p
  ),
  missing AS (
    SELECT 'missing_posting'::text AS check_type, e.lease_id, e.period, 'All accounts'::text AS account,
           0::numeric AS posted, round(e.i + e.d + e.p, 2) AS expected
    FROM expected_rows e
    WHERE e.i + e.d + e.p > 0
      AND NOT EXISTS (SELECT 1 FROM covered c WHERE c.lease_id = e.lease_id AND c.period = e.period)
  ),
  schedule_diffs AS (
    SELECT 'posted_vs_schedule'::text AS check_type, COALESCE(p.lease_id, x.lease_id) AS lease_id,
           COALESCE(p.period, x.period) AS period, COALESCE(p.acct, x.acct) AS account,
           round(COALESCE(p.amt, 0), 2) AS posted, round(COALESCE(x.amt, 0), 2) AS expected
    FROM posted p
    FULL JOIN expected x ON x.lease_id = p.lease_id AND x.period = p.period AND x.acct = p.acct
  ),
  je_periodic AS (
    SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
           sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
    FROM public.journal_entries j
    WHERE j.organization_id = p_org
      AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT lk.period FROM locked lk)
      AND j.entry_type NOT IN (SELECT t FROM event_types)
    GROUP BY 1, 2, 3
  ),
  events AS (
    SELECT x.lease_id, x.period, x.acct, sum(x.amt) AS amt FROM (
      SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM') AS period, internal.normalize_account(e.account_debited) AS acct, COALESCE(e.amount, 0) AS amt
      FROM public.lease_transactions e
      WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT lk.period FROM locked lk)
      UNION ALL
      SELECT e.lease_id, to_char(e.transaction_date, 'YYYY-MM'), internal.normalize_account(e.account_credited), -COALESCE(e.amount, 0)
      FROM public.lease_transactions e
      WHERE e.organization_id = p_org AND to_char(e.transaction_date, 'YYYY-MM') IN (SELECT lk.period FROM locked lk)
    ) x GROUP BY 1, 2, 3
  ),
  je_events AS (
    SELECT j.lease_id, to_char(j.entry_date, 'YYYY-MM') AS period, internal.normalize_account(j.account_name) AS acct,
           sum(COALESCE(j.debit_amount, 0) - COALESCE(j.credit_amount, 0)) AS amt
    FROM public.journal_entries j
    WHERE j.organization_id = p_org
      AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT lk.period FROM locked lk)
      AND j.entry_type IN (SELECT t FROM event_types)
    GROUP BY 1, 2, 3
  ),
  journal_diffs AS (
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
    WHERE j.organization_id = p_org AND to_char(j.entry_date, 'YYYY-MM') IN (SELECT lk.period FROM locked lk)
    GROUP BY j.lease_id, j.entry_date, j.entry_type
    HAVING abs(sum(COALESCE(j.debit_amount, 0)) - sum(COALESCE(j.credit_amount, 0))) > 0.01
    UNION ALL
    SELECT 'unbalanced_posted_entry', t.lease_id, t.period, COALESCE(t.transaction_type, ''),
           round(sum(COALESCE(t.debit_amount, 0)), 2), round(sum(COALESCE(t.credit_amount, 0)), 2)
    FROM public.transactions t
    WHERE t.organization_id = p_org AND t.period IN (SELECT lk.period FROM locked lk)
    GROUP BY t.lease_id, t.period, t.transaction_type
    HAVING abs(sum(COALESCE(t.debit_amount, 0)) - sum(COALESCE(t.credit_amount, 0))) > 0.01
  )
  SELECT r.check_type, r.lease_id, l.lease_name, r.period, r.account, r.posted, r.expected, round(r.posted - r.expected, 2)
  FROM (
    SELECT m.* FROM missing m
    UNION ALL
    SELECT d.* FROM schedule_diffs d
    WHERE abs(d.posted - d.expected) > 0.01
      AND EXISTS (SELECT 1 FROM covered c WHERE c.lease_id = d.lease_id AND c.period = d.period)
    UNION ALL
    SELECT d.* FROM journal_diffs d
    WHERE abs(d.posted - d.expected) > 0.01
      AND (
        (d.check_type = 'posted_vs_journal' AND EXISTS (
          SELECT 1 FROM je_periodic j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
        OR (d.check_type = 'events_vs_journal' AND EXISTS (
          SELECT 1 FROM je_events j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
      )
    UNION ALL
    SELECT u.* FROM unbalanced u
  ) r
  LEFT JOIN public.leases l ON l.id = r.lease_id
  ORDER BY r.period, l.lease_name, r.check_type, r.account;
$$;

CREATE OR REPLACE FUNCTION internal.reconcile_ledgers(p_org uuid, p_from date, p_to date)
RETURNS TABLE(check_type text, lease_id uuid, lease_name text, period text, account text,
              posted numeric, expected numeric, difference numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
  SELECT * FROM internal.reconcile_ledgers(p_org, p_from, p_to, false);
$$;

CREATE OR REPLACE FUNCTION public.get_ledger_reconciliation(p_from date, p_to date, p_include_prepared_catch_up boolean)
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
  RETURN QUERY SELECT * FROM internal.reconcile_ledgers(internal.current_org_id(), p_from, p_to, COALESCE(p_include_prepared_catch_up, false));
END;
$$;

REVOKE ALL ON FUNCTION internal.reconcile_ledgers(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.reconcile_ledgers(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ledger_reconciliation(date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(date, date, boolean) TO authenticated;

/*
# Ledger reconciliation: compare only months that still have projected entries

Projected journal entries are kept only for months after the last locked month, so most locked
months have no projected rows at all. Comparing those months against posted entries reported every
posted line as a difference. The posted-vs-journal and events-vs-journal checks now only compare
lease/months where projected entries exist. The unbalanced-entry checks are unchanged.

No data is changed. Function re-created in full (no in-place text edits).
*/

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
    SELECT d.* FROM diffs d
    WHERE abs(d.posted - d.expected) > 0.01
      AND (
        (d.check_type = 'posted_vs_journal' AND EXISTS (
          SELECT 1 FROM je_periodic j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
        OR (d.check_type = 'events_vs_journal' AND EXISTS (
          SELECT 1 FROM je_events j WHERE j.lease_id IS NOT DISTINCT FROM d.lease_id AND j.period = d.period))
      )
    UNION ALL
    SELECT * FROM unbalanced
  ) r
  LEFT JOIN public.leases l ON l.id = r.lease_id
  ORDER BY r.period, l.lease_name, r.check_type, r.account;
$$;

REVOKE ALL ON FUNCTION internal.reconcile_ledgers(uuid, date, date) FROM PUBLIC, anon, authenticated;

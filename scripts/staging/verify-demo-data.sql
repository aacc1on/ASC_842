-- Checks the staging demo organization after the RESET (also run by CI against an empty database).
-- Returns one row; "problems" is empty when every check passes.
WITH demo AS (
  SELECT organization_id AS org FROM public.user_profiles WHERE user_id = 'de300000-0000-4000-8000-000000000001'
),
lease_stats AS (
  SELECT l.lease_name,
         (SELECT count(*) FROM public.amortization_schedules a WHERE a.lease_id = l.id) AS periods,
         (SELECT count(*) FROM public.journal_entries j WHERE j.lease_id = l.id) AS entries,
         (SELECT coalesce(sum(j.debit_amount), 0) - coalesce(sum(j.credit_amount), 0)
            FROM public.journal_entries j WHERE j.lease_id = l.id) AS difference
  FROM public.leases l JOIN demo ON l.organization_id = demo.org
),
totals AS (
  SELECT
    (SELECT count(*) FROM demo) AS demo_orgs,
    (SELECT count(*) FROM lease_stats) AS leases,
    (SELECT count(*) FROM lease_stats WHERE periods = 0) AS leases_without_schedule,
    (SELECT count(*) FROM public.leases_missing_amortization m JOIN demo ON m.organization_id = demo.org) AS missing_amortization,
    (SELECT count(*) FROM lease_stats WHERE entries = 0) AS leases_without_journal,
    (SELECT coalesce(sum(periods), 0) FROM lease_stats) AS schedule_rows,
    (SELECT coalesce(sum(entries), 0) FROM lease_stats) AS journal_entries,
    (SELECT coalesce(sum(j.debit_amount), 0) FROM public.journal_entries j JOIN demo ON j.organization_id = demo.org) AS total_debits,
    (SELECT coalesce(sum(j.credit_amount), 0) FROM public.journal_entries j JOIN demo ON j.organization_id = demo.org) AS total_credits,
    (SELECT string_agg(lease_name, ', ' ORDER BY lease_name) FROM lease_stats WHERE periods = 0) AS no_schedule_names,
    (SELECT string_agg(lease_name || ' (' || round(difference, 2) || ')', ', ' ORDER BY lease_name)
       FROM lease_stats WHERE abs(difference) > 0.005) AS unbalanced_names
)
SELECT t.leases, t.schedule_rows, t.journal_entries, t.total_debits::text, t.total_credits::text,
  array_remove(ARRAY[
    CASE WHEN t.demo_orgs <> 1 THEN 'demo organization not found' END,
    CASE WHEN t.leases = 0 THEN 'demo organization has no leases' END,
    CASE WHEN t.leases_without_schedule > 0 THEN t.leases_without_schedule || ' demo lease(s) have no amortization schedule: ' || t.no_schedule_names END,
    CASE WHEN t.missing_amortization > 0 THEN 'leases_missing_amortization returns ' || t.missing_amortization || ' row(s) for the demo organization' END,
    CASE WHEN t.leases_without_journal > 0 THEN t.leases_without_journal || ' demo lease(s) have no journal entries' END,
    CASE WHEN t.unbalanced_names IS NOT NULL THEN 'journal debits do not equal credits for: ' || t.unbalanced_names END,
    CASE WHEN abs(t.total_debits - t.total_credits) > 0.005 THEN 'total journal debits ' || t.total_debits || ' <> credits ' || t.total_credits END
  ], NULL) AS problems
FROM totals t;

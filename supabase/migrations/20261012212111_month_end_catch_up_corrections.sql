/*
# Month-end catch-up corrections (prepared, posted with the next month-end)

## Why
Month-end posting loaded at most 1,000 amortization-schedule rows, so some leases were silently left
out of earlier month-ends (187 lease-months across 9 leases in MS Consulting). Those months are locked
and stay untouched. The missed amounts are instead booked as a clearly labelled catch-up in the first
open month (October 2026 for MS Consulting), when that month-end is posted.

## 1. Transaction type
- `transactions.transaction_type` now also allows `month_end_catch_up`.

## 2. New tables
- `month_end_catch_up_batches`: one batch per lease and posting month.
  - `organization_id`, `lease_id`, `posting_period` (YYYY-MM), `posting_date` (last day of that month)
  - `first_missed_period`, `last_missed_period`, `missed_months`, `description`
  - `total_interest`, `total_amortization`, `total_payment`, `total_debits`, `total_credits` (must be equal)
  - `status` (`prepared` until the month-end document of `posting_period` is posted, then `posted`)
  - `month_end_document_id` (linked as soon as that month-end document exists), `posted_at`, `created_at`
- `month_end_catch_up_lines`: the audit detail, one row per lease, missed month and component.
  - `batch_id`, `organization_id`, `lease_id`, `missed_period`, `schedule_period_number`
  - `component` (`interest`, `amortization`, `payment`), `account_debited`, `account_credited`, `amount`
  - A lease-month component can be caught up only once (unique lease_id + missed_period + component).

## 3. Functions and triggers
- `internal.lease_period_number(start, period)`: schedule period number of a calendar month.
- `internal.prepare_month_end_catch_up(org)`: finds every lease-month in a locked month that has a
  schedule row but no month-end posting, and adds it to that lease's prepared batch for the first open
  month. Writes one `Catch-up prepared` audit entry with counts and totals. Safe to run again.
- `internal.post_month_end_catch_up()` (trigger on `month_end_documents`): links prepared batches to the
  month-end document of their posting month, and when that document becomes `posted` inserts one
  balanced `month_end_catch_up` transaction per lease and component (Dr/Cr per the normal month-end
  accounts), marks the batches `posted` and writes a `Catch-up posted` audit entry.
- `internal.reset_month_end_catch_up()` (before delete on `month_end_documents`): if the posting
  month-end is removed, its batches return to `prepared` (the posted rows are removed with the document).
- `internal.post_month_end_entries()`: no longer re-posts entries when a finalized or closed document is
  reopened (finalized -> posted), which would have duplicated every posted row.

## 4. Audit actions
- `audit_log.action` also allows `Catch-up prepared`, `Catch-up posted` and `EXPORT` (the backup export
  already wrote `EXPORT`, which was being rejected).

## 5. Security
- RLS enabled on both tables. Members with data access can read their organization's rows.
- No insert, update or delete policies, and write privileges are revoked: rows are created and changed
  only by the functions above. All functions are SECURITY DEFINER with EXECUTE revoked from clients.

## 6. Data
- Prepares the catch-up for every organization that has missed lease-months. Nothing is posted and no
  locked month is changed.
*/

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_transaction_type_check CHECK (transaction_type = ANY (ARRAY[
  'payment', 'interest', 'amortization', 'initial_recognition', 'lease_modification', 'lease_cancellation',
  'impairment', 'derecognition', 'reversal', 'operating_lease_expense', 'short_term_lease_expense',
  'nonlease_component_expense', 'month_end_catch_up'
]::text[]));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action = ANY (ARRAY[
  'INSERT', 'UPDATE', 'DELETE', 'BACKFILL', 'REOPEN', 'Self-approved', 'Auto-approved (single-user plan)',
  'Approved', 'Rejected', 'Auto-approved (approval workflow off)', 'Catch-up prepared', 'Catch-up posted', 'EXPORT'
]::text[]));

CREATE TABLE IF NOT EXISTS public.month_end_catch_up_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lease_id uuid NOT NULL REFERENCES public.leases(id),
  posting_period text NOT NULL CHECK (posting_period ~ '^\d{4}-\d{2}$'),
  posting_date date NOT NULL,
  transaction_type text NOT NULL DEFAULT 'month_end_catch_up',
  first_missed_period text NOT NULL,
  last_missed_period text NOT NULL,
  missed_months integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  total_interest numeric(15,2) NOT NULL DEFAULT 0,
  total_amortization numeric(15,2) NOT NULL DEFAULT 0,
  total_payment numeric(15,2) NOT NULL DEFAULT 0,
  total_debits numeric(15,2) NOT NULL DEFAULT 0,
  total_credits numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'posted')),
  month_end_document_id uuid REFERENCES public.month_end_documents(id) ON DELETE SET NULL,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT month_end_catch_up_batches_balanced CHECK (total_debits = total_credits),
  CONSTRAINT month_end_catch_up_batches_lease_period_key UNIQUE (lease_id, posting_period)
);

CREATE INDEX IF NOT EXISTS month_end_catch_up_batches_org_period_idx
  ON public.month_end_catch_up_batches (organization_id, posting_period);
CREATE INDEX IF NOT EXISTS month_end_catch_up_batches_document_idx
  ON public.month_end_catch_up_batches (month_end_document_id);

CREATE TABLE IF NOT EXISTS public.month_end_catch_up_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.month_end_catch_up_batches(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lease_id uuid NOT NULL REFERENCES public.leases(id),
  missed_period text NOT NULL CHECK (missed_period ~ '^\d{4}-\d{2}$'),
  schedule_period_number integer NOT NULL,
  component text NOT NULL CHECK (component IN ('interest', 'amortization', 'payment')),
  account_debited text NOT NULL,
  account_credited text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT month_end_catch_up_lines_once UNIQUE (lease_id, missed_period, component)
);

CREATE INDEX IF NOT EXISTS month_end_catch_up_lines_batch_idx ON public.month_end_catch_up_lines (batch_id);
CREATE INDEX IF NOT EXISTS month_end_catch_up_lines_org_idx ON public.month_end_catch_up_lines (organization_id, lease_id);

ALTER TABLE public.month_end_catch_up_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.month_end_catch_up_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.month_end_catch_up_batches FROM anon;
REVOKE ALL ON public.month_end_catch_up_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.month_end_catch_up_batches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.month_end_catch_up_lines FROM authenticated;
GRANT SELECT ON public.month_end_catch_up_batches TO authenticated;
GRANT SELECT ON public.month_end_catch_up_lines TO authenticated;

DROP POLICY IF EXISTS "select_org_catch_up_batches" ON public.month_end_catch_up_batches;
CREATE POLICY "select_org_catch_up_batches" ON public.month_end_catch_up_batches FOR SELECT
  TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()) AND (SELECT internal.has_data_access()));

DROP POLICY IF EXISTS "select_org_catch_up_lines" ON public.month_end_catch_up_lines;
CREATE POLICY "select_org_catch_up_lines" ON public.month_end_catch_up_lines FOR SELECT
  TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()) AND (SELECT internal.has_data_access()));

DROP TRIGGER IF EXISTS audit_log_month_end_catch_up_batches ON public.month_end_catch_up_batches;
CREATE TRIGGER audit_log_month_end_catch_up_batches
  AFTER INSERT OR UPDATE OR DELETE ON public.month_end_catch_up_batches
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

CREATE OR REPLACE FUNCTION internal.lease_period_number(p_start date, p_period text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'internal'
AS $$
  SELECT ((extract(year FROM to_date(p_period, 'YYYY-MM')) - extract(year FROM p_start)) * 12
        + extract(month FROM to_date(p_period, 'YYYY-MM')) - extract(month FROM p_start))::int + 1;
$$;

CREATE OR REPLACE FUNCTION internal.prepare_month_end_catch_up(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
DECLARE
  v_posting text;
  v_date date;
  v_new_lines integer;
  v_summary jsonb;
BEGIN
  SELECT to_char(max(to_date(ap.period, 'YYYY-MM')) + interval '1 month', 'YYYY-MM') INTO v_posting
  FROM public.accounting_periods ap
  WHERE ap.organization_id = p_org AND ap.status IN ('locked', 'closed');
  IF v_posting IS NULL THEN
    RETURN jsonb_build_object('organization_id', p_org, 'new_lines', 0);
  END IF;
  v_date := (to_date(v_posting, 'YYYY-MM') + interval '1 month' - interval '1 day')::date;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.catch_up_gaps (
    lease_id uuid, cls text, period text, period_number int, i numeric, d numeric, p numeric
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.catch_up_gaps;

  INSERT INTO pg_temp.catch_up_gaps
  SELECT l.id, l.lease_classification, ap.period, s.period_number,
         COALESCE(s.interest_expense, 0), COALESCE(s.depreciation_expense, 0), COALESCE(s.payment_amount, 0)
  FROM public.accounting_periods ap
  JOIN public.leases l ON l.organization_id = p_org
    AND l.accounting_treatment IS DISTINCT FROM 'short_term_exemption'
    AND date_trunc('month', l.lease_start_date) <= to_date(ap.period, 'YYYY-MM')
  JOIN public.amortization_schedules s ON s.lease_id = l.id
    AND s.period_number = internal.lease_period_number(l.lease_start_date, ap.period)
  WHERE ap.organization_id = p_org AND ap.status IN ('locked', 'closed')
    AND NOT EXISTS (SELECT 1 FROM public.transactions t
                    WHERE t.lease_id = l.id AND t.period = ap.period AND t.month_end_document_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.month_end_catch_up_lines c
                    WHERE c.lease_id = l.id AND c.missed_period = ap.period);

  IF NOT EXISTS (SELECT 1 FROM pg_temp.catch_up_gaps) THEN
    RETURN jsonb_build_object('organization_id', p_org, 'posting_period', v_posting, 'new_lines', 0);
  END IF;

  IF EXISTS (SELECT 1 FROM public.month_end_catch_up_batches b
             JOIN pg_temp.catch_up_gaps g ON g.lease_id = b.lease_id
             WHERE b.posting_period = v_posting AND b.status = 'posted') THEN
    RAISE EXCEPTION 'Catch-up for % is already posted; new gaps need a later posting month', v_posting;
  END IF;

  INSERT INTO public.month_end_catch_up_batches
    (organization_id, lease_id, posting_period, posting_date, first_missed_period, last_missed_period, month_end_document_id)
  SELECT p_org, g.lease_id, v_posting, v_date, min(g.period), max(g.period),
         (SELECT d.id FROM public.month_end_documents d WHERE d.organization_id = p_org AND d.period = v_posting
          ORDER BY d.created_at DESC LIMIT 1)
  FROM pg_temp.catch_up_gaps g
  GROUP BY g.lease_id
  ON CONFLICT (lease_id, posting_period) DO NOTHING;

  INSERT INTO public.month_end_catch_up_lines
    (batch_id, organization_id, lease_id, missed_period, schedule_period_number, component,
     account_debited, account_credited, amount)
  SELECT b.id, p_org, g.lease_id, g.period, g.period_number, c.component, c.dr, c.cr, c.amt
  FROM pg_temp.catch_up_gaps g
  JOIN public.month_end_catch_up_batches b ON b.lease_id = g.lease_id AND b.posting_period = v_posting
  CROSS JOIN LATERAL (VALUES
    ('interest',
     CASE WHEN g.cls = 'operating' THEN 'Operating Lease Expense' ELSE 'Interest Expense' END,
     'Lease Liability', round(g.i, 2)),
    ('amortization',
     CASE WHEN g.cls = 'operating' THEN 'Operating Lease Expense' ELSE 'Depreciation Expense' END,
     CASE WHEN g.cls = 'operating' THEN 'ROU Asset' ELSE 'Accumulated Depreciation - ROU Asset' END,
     round(g.d, 2)),
    ('payment', 'Lease Liability', 'Cash', round(g.p, 2))
  ) AS c(component, dr, cr, amt)
  WHERE c.amt > 0
  ON CONFLICT (lease_id, missed_period, component) DO NOTHING;
  GET DIAGNOSTICS v_new_lines = ROW_COUNT;

  UPDATE public.month_end_catch_up_batches b
  SET first_missed_period = x.first_p,
      last_missed_period = x.last_p,
      missed_months = x.months,
      total_interest = x.ti,
      total_amortization = x.ta,
      total_payment = x.tp,
      total_debits = x.ti + x.ta + x.tp,
      total_credits = x.ti + x.ta + x.tp,
      description = 'Catch-up for missed month-end postings '
        || to_char(to_date(x.first_p, 'YYYY-MM'), 'FMMonth YYYY')
        || CASE WHEN x.first_p <> x.last_p
             THEN ' – ' || to_char(to_date(x.last_p, 'YYYY-MM'), 'FMMonth YYYY') ELSE '' END
        || ' (system error: schedule truncated at 1,000 rows)'
  FROM (
    SELECT l.batch_id, min(l.missed_period) AS first_p, max(l.missed_period) AS last_p,
           count(DISTINCT l.missed_period)::int AS months,
           COALESCE(sum(l.amount) FILTER (WHERE l.component = 'interest'), 0) AS ti,
           COALESCE(sum(l.amount) FILTER (WHERE l.component = 'amortization'), 0) AS ta,
           COALESCE(sum(l.amount) FILTER (WHERE l.component = 'payment'), 0) AS tp
    FROM public.month_end_catch_up_lines l
    GROUP BY l.batch_id
  ) x
  WHERE x.batch_id = b.id AND b.organization_id = p_org AND b.posting_period = v_posting AND b.status = 'prepared';

  SELECT jsonb_build_object(
    'organization_id', p_org,
    'posting_period', v_posting,
    'posting_date', v_date,
    'new_lines', v_new_lines,
    'batches', count(*),
    'lease_months', sum(b.missed_months),
    'lines', (SELECT count(*) FROM public.month_end_catch_up_lines l
              JOIN public.month_end_catch_up_batches bb ON bb.id = l.batch_id
              WHERE bb.organization_id = p_org AND bb.posting_period = v_posting),
    'total_interest', sum(b.total_interest),
    'total_amortization', sum(b.total_amortization),
    'total_payment', sum(b.total_payment),
    'total_debits', sum(b.total_debits),
    'total_credits', sum(b.total_credits),
    'leases', jsonb_agg(jsonb_build_object(
      'lease_id', b.lease_id, 'lease_name', le.lease_name, 'first', b.first_missed_period,
      'last', b.last_missed_period, 'months', b.missed_months, 'interest', b.total_interest,
      'amortization', b.total_amortization, 'payment', b.total_payment) ORDER BY le.lease_name)
  ) INTO v_summary
  FROM public.month_end_catch_up_batches b
  JOIN public.leases le ON le.id = b.lease_id
  WHERE b.organization_id = p_org AND b.posting_period = v_posting;

  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (p_org, auth.uid(), 'month_end_catch_up_batches', v_posting, 'Catch-up prepared', NULL, v_summary, NULL);

  RETURN v_summary;
END;
$$;

CREATE OR REPLACE FUNCTION internal.post_month_end_catch_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
DECLARE
  v_rows integer;
  v_summary jsonb;
BEGIN
  UPDATE public.month_end_catch_up_batches b
  SET month_end_document_id = NEW.id
  WHERE b.organization_id = NEW.organization_id AND b.posting_period = NEW.period
    AND b.status = 'prepared' AND b.month_end_document_id IS DISTINCT FROM NEW.id;

  IF NEW.status = 'posted'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') NOT IN ('posted', 'finalized', 'closed')) THEN
    INSERT INTO public.transactions (user_id, organization_id, lease_id, transaction_date, transaction_type,
      account_debited, account_credited, debit_amount, credit_amount, description, reference_number, period,
      month_end_document_id)
    SELECT NEW.user_id, b.organization_id, b.lease_id, b.posting_date, 'month_end_catch_up',
           l.account_debited, l.account_credited, sum(l.amount), sum(l.amount),
           b.description || ' - ' || CASE l.component
             WHEN 'interest' THEN 'interest'
             WHEN 'amortization' THEN CASE WHEN l.account_credited = 'ROU Asset' THEN 'ROU amortization' ELSE 'depreciation' END
             ELSE 'payments' END,
           'ME-CU-' || CASE l.component
             WHEN 'interest' THEN CASE WHEN l.account_debited = 'Operating Lease Expense' THEN 'OLE-INT' ELSE 'INT' END
             WHEN 'amortization' THEN CASE WHEN l.account_debited = 'Operating Lease Expense' THEN 'OLE-ROU' ELSE 'DEP' END
             ELSE 'PMT' END
             || '-' || b.posting_period || '-' || left(b.lease_id::text, 8),
           b.posting_period, NEW.id
    FROM public.month_end_catch_up_batches b
    JOIN public.month_end_catch_up_lines l ON l.batch_id = b.id
    WHERE b.organization_id = NEW.organization_id AND b.posting_period = NEW.period AND b.status = 'prepared'
    GROUP BY b.id, b.organization_id, b.lease_id, b.posting_date, b.description, b.posting_period,
             l.component, l.account_debited, l.account_credited;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
      SELECT jsonb_build_object('posting_period', NEW.period, 'month_end_document_id', NEW.id,
               'batches', count(*), 'transactions', v_rows, 'lease_months', sum(missed_months),
               'total_debits', sum(total_debits), 'total_credits', sum(total_credits))
      INTO v_summary
      FROM public.month_end_catch_up_batches
      WHERE organization_id = NEW.organization_id AND posting_period = NEW.period AND status = 'prepared';

      UPDATE public.month_end_catch_up_batches
      SET status = 'posted', posted_at = now(), month_end_document_id = NEW.id
      WHERE organization_id = NEW.organization_id AND posting_period = NEW.period AND status = 'prepared';

      INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
      VALUES (NEW.organization_id, auth.uid(), 'month_end_catch_up_batches', NEW.period, 'Catch-up posted', NULL, v_summary, NULL);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION internal.reset_month_end_catch_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
BEGIN
  UPDATE public.month_end_catch_up_batches
  SET status = 'prepared', posted_at = NULL, month_end_document_id = NULL
  WHERE month_end_document_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION internal.post_month_end_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'internal'
AS $$
BEGIN
  IF NEW.status = 'posted' AND NEW.entries IS NOT NULL AND jsonb_typeof(NEW.entries) = 'array'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') NOT IN ('posted', 'finalized', 'closed')) THEN
    INSERT INTO public.transactions (user_id, organization_id, lease_id, transaction_date, transaction_type,
      account_debited, account_credited, debit_amount, credit_amount, description, reference_number, period,
      month_end_document_id)
    SELECT NEW.user_id, NEW.organization_id, (e->>'lease_id')::uuid, (e->>'transaction_date')::date,
           e->>'transaction_type', e->>'account_debited', e->>'account_credited',
           (e->>'debit_amount')::numeric, (e->>'credit_amount')::numeric, e->>'description',
           e->>'reference_number', e->>'period', NEW.id
    FROM jsonb_array_elements(NEW.entries) e
    WHERE EXISTS (SELECT 1 FROM public.leases l
                  WHERE l.id = (e->>'lease_id')::uuid AND l.organization_id = NEW.organization_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_month_end_catch_up ON public.month_end_documents;
CREATE TRIGGER post_month_end_catch_up
  AFTER INSERT OR UPDATE OF status ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.post_month_end_catch_up();

DROP TRIGGER IF EXISTS post_month_end_catch_up_reset ON public.month_end_documents;
CREATE TRIGGER post_month_end_catch_up_reset
  BEFORE DELETE ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.reset_month_end_catch_up();

REVOKE ALL ON FUNCTION internal.lease_period_number(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prepare_month_end_catch_up(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.post_month_end_catch_up() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.reset_month_end_catch_up() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.post_month_end_entries() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT ap.organization_id FROM public.accounting_periods ap
           WHERE ap.status IN ('locked', 'closed') AND ap.organization_id IS NOT NULL LOOP
    PERFORM internal.prepare_month_end_catch_up(r.organization_id);
  END LOOP;
END $$;

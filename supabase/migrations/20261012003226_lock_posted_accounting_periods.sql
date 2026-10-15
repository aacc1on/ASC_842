/*
# Lock posted accounting periods

Posting a month-end document now really locks that month. Before this change the
accounting_periods table was never written, so every "locked period" check was inert.

1. Modified tables
- `accounting_periods`
  - New unique index on (organization_id, period): exactly one row per organization and month.
  - The old per-user unique key (user_id, period) is removed (periods belong to the organization, not a user).
  - Rows are now maintained only by the database: browser roles can read but no longer
    insert, update or delete them directly.

2. New functions
- `internal.locked_period_status(org, from_date, to_date)` returns 'locked'/'closed' when any
  locked month of that organization overlaps the date range, otherwise null.
- `internal.sync_accounting_period_lock()` trigger on month_end_documents:
  - posted/finalized/closed document -> month row upserted with status 'locked'
  - reopen (finalized/closed -> posted), status leaving posted, or deleting the posted
    document -> month row set back to 'open'
- `internal.prevent_locked_amortization_mutation()` / `internal.prevent_locked_payment_schedule_mutation()`
  BEFORE UPDATE/DELETE triggers on amortization_schedules and lease_payment_schedules.
- `public.get_lease_posted_through(lease_id)` returns the latest locked month that falls inside
  the lease term (used for the "Posted through" badge).

3. Hardened existing triggers
- Journal entry and lease transaction period locks now check both the old and new date and use
  the row's organization instead of the caller's.

4. Backfill
- One locked row per organization + month for every posted/finalized/closed month-end
  document. Posted entries are not changed.

Notes
1. Service-role calls (auth.uid() is null) bypass the row locks, as before.
2. All triggers return OLD on DELETE.
*/

ALTER TABLE public.accounting_periods DROP CONSTRAINT IF EXISTS accounting_periods_user_id_period_key;
CREATE UNIQUE INDEX IF NOT EXISTS accounting_periods_org_period_key
  ON public.accounting_periods (organization_id, period);
CREATE INDEX IF NOT EXISTS accounting_periods_org_range_idx
  ON public.accounting_periods (organization_id, period_start, period_end) WHERE status IN ('locked','closed');

REVOKE INSERT, UPDATE, DELETE ON public.accounting_periods FROM anon, authenticated;

CREATE OR REPLACE FUNCTION internal.locked_period_status(p_org uuid, p_from date, p_to date)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT ap.status FROM public.accounting_periods ap
  WHERE ap.organization_id = p_org
    AND ap.status IN ('locked','closed')
    AND ap.period_start <= p_to
    AND ap.period_end >= p_from
  ORDER BY ap.period_start DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION internal.locked_period_status(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION internal.sync_accounting_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_posted constant text[] := ARRAY['posted','finalized','closed'];
  v_doc public.month_end_documents;
  v_lock boolean;
  v_start date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_doc := OLD;
    v_lock := NULL;
    IF OLD.status = ANY (v_posted) THEN v_lock := false; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_doc := NEW;
    v_lock := CASE WHEN NEW.status = ANY (v_posted) THEN true END;
  ELSE
    v_doc := NEW;
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NULL;
    ELSIF OLD.status IN ('finalized','closed') AND NEW.status = 'posted' THEN
      v_lock := false;
    ELSIF NEW.status = ANY (v_posted) THEN
      v_lock := true;
    ELSIF OLD.status = ANY (v_posted) THEN
      v_lock := false;
    END IF;
  END IF;

  IF v_lock IS NULL THEN
    RETURN NULL;
  END IF;

  v_start := to_date(left(v_doc.period, 7) || '-01', 'YYYY-MM-DD');

  IF v_lock THEN
    INSERT INTO public.accounting_periods
      (organization_id, user_id, period, period_start, period_end, status, closed_at, closed_by)
    VALUES
      (v_doc.organization_id, v_doc.user_id, left(v_doc.period, 7), v_start,
       (v_start + interval '1 month' - interval '1 day')::date, 'locked', now(),
       COALESCE(auth.uid(), v_doc.user_id)::text)
    ON CONFLICT (organization_id, period) DO UPDATE
      SET status = 'locked', closed_at = now(), closed_by = EXCLUDED.closed_by;
  ELSE
    UPDATE public.accounting_periods
      SET status = 'open', closed_at = NULL
      WHERE organization_id = v_doc.organization_id AND period = left(v_doc.period, 7);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_accounting_period_lock ON public.month_end_documents;
CREATE TRIGGER sync_accounting_period_lock
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.month_end_documents
  FOR EACH ROW EXECUTE FUNCTION internal.sync_accounting_period_lock();

CREATE OR REPLACE FUNCTION internal.prevent_locked_amortization_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_status := internal.locked_period_status(OLD.organization_id, OLD.period_date, OLD.period_date);
    IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
      v_status := internal.locked_period_status(OLD.organization_id, NEW.period_date, NEW.period_date);
    END IF;
    IF v_status IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot change the amortization schedule for %: that month is posted (%). Use Contract Modification instead.',
        to_char(OLD.period_date, 'FMMonth YYYY'), v_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_locked_amortization_mutation ON public.amortization_schedules;
CREATE TRIGGER prevent_locked_amortization_mutation
  BEFORE UPDATE OR DELETE ON public.amortization_schedules
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_locked_amortization_mutation();

CREATE OR REPLACE FUNCTION internal.prevent_locked_payment_schedule_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_lease_start date;
  v_from date;
  v_to date;
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT l.lease_start_date INTO v_lease_start FROM public.leases l WHERE l.id = OLD.lease_id;
    IF v_lease_start IS NOT NULL THEN
      v_from := (v_lease_start + make_interval(months => GREATEST(OLD.from_month, 1) - 1))::date;
      v_to := (v_lease_start + make_interval(months => GREATEST(OLD.to_month, OLD.from_month, 1)) - interval '1 day')::date;
      v_status := internal.locked_period_status(OLD.organization_id, v_from, v_to);
      IF v_status IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot change payment schedule months %-%: they include posted periods. Use Contract Modification instead.',
          OLD.from_month, OLD.to_month;
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_locked_payment_schedule_mutation ON public.lease_payment_schedules;
CREATE TRIGGER prevent_locked_payment_schedule_mutation
  BEFORE UPDATE OR DELETE ON public.lease_payment_schedules
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_locked_payment_schedule_mutation();

CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_je()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_status := internal.locked_period_status(OLD.organization_id, OLD.entry_date, OLD.entry_date);
    IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
      v_status := internal.locked_period_status(OLD.organization_id, NEW.entry_date, NEW.entry_date);
    END IF;
    IF v_status IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify journal entries in a % accounting period', v_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_lt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_status := internal.locked_period_status(OLD.organization_id, OLD.transaction_date, OLD.transaction_date);
    IF v_status IS NULL AND TG_OP = 'UPDATE' THEN
      v_status := internal.locked_period_status(OLD.organization_id, NEW.transaction_date, NEW.transaction_date);
    END IF;
    IF v_status IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify lease transactions in a % accounting period', v_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lease_posted_through(p_lease_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT max(ap.period_start)
  FROM public.leases l
  JOIN public.accounting_periods ap
    ON ap.organization_id = l.organization_id
   AND ap.status IN ('locked','closed')
   AND ap.period_end >= l.lease_start_date
   AND ap.period_start <= COALESCE(l.lease_end_date, ap.period_start)
  WHERE l.id = p_lease_id;
$$;
REVOKE ALL ON FUNCTION public.get_lease_posted_through(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lease_posted_through(uuid) TO authenticated;

INSERT INTO public.accounting_periods
  (organization_id, user_id, period, period_start, period_end, status, closed_at, closed_by)
SELECT DISTINCT ON (d.organization_id, left(d.period, 7))
  d.organization_id, d.user_id, left(d.period, 7),
  to_date(left(d.period, 7) || '-01', 'YYYY-MM-DD'),
  (to_date(left(d.period, 7) || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date,
  'locked', COALESCE(d.created_at, now()), d.user_id::text
FROM public.month_end_documents d
WHERE d.status IN ('posted','finalized','closed')
ORDER BY d.organization_id, left(d.period, 7), d.created_at DESC
ON CONFLICT (organization_id, period) DO UPDATE
  SET status = 'locked';

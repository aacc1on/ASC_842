/*
# Error alert email throttle

Adds what is needed to email error alerts at most once per error type per 15 minutes.

1. New Tables
- `internal.error_alert_email_throttle`
  - `alert_type` (text, primary key) e.g. "critical:save_lease", "threshold:any", "test"
  - `last_sent_at` (timestamptz) last time an email slot was granted for this type
  - `suppressed_count` (int) alerts skipped for this type since the last email

2. Modified Tables
- `internal.error_alerts`
  - new nullable column `sample_org_id` (uuid): organization of the sample error (shown masked in emails)
  - delivery_status now also allows 'throttled'

3. Functions
- `public.claim_alert_email_slot(p_alert_type, p_window_minutes)` -> boolean. Atomically grants a slot
  if none was granted for this type within the window; otherwise counts a suppression. service_role only.
- `public.claim_pending_error_alerts()` now also returns `sample_org_id` and `suppressed_count`.
- `internal.error_logs_alert_check()` now records `sample_org_id`.

4. Security
- RLS enabled on the new table with no policies (only service_role / security definer functions use it).
- No customer data is read or changed.
*/

CREATE TABLE IF NOT EXISTS internal.error_alert_email_throttle (
  alert_type text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  suppressed_count int NOT NULL DEFAULT 0
);
ALTER TABLE internal.error_alert_email_throttle ENABLE ROW LEVEL SECURITY;

ALTER TABLE internal.error_alerts ADD COLUMN IF NOT EXISTS sample_org_id uuid;

ALTER TABLE internal.error_alerts DROP CONSTRAINT IF EXISTS error_alerts_delivery_status_check;
ALTER TABLE internal.error_alerts ADD CONSTRAINT error_alerts_delivery_status_check
  CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed', 'not_configured', 'throttled'));

CREATE OR REPLACE FUNCTION public.claim_alert_email_slot(p_alert_type text, p_window_minutes int DEFAULT 15)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, pg_temp
AS $$
DECLARE
  v_granted boolean;
BEGIN
  IF p_alert_type IS NULL OR length(p_alert_type) = 0 OR length(p_alert_type) > 100 THEN
    RAISE EXCEPTION 'Invalid alert type';
  END IF;
  INSERT INTO internal.error_alert_email_throttle AS t (alert_type, last_sent_at, suppressed_count)
  VALUES (p_alert_type, now(), 0)
  ON CONFLICT (alert_type) DO UPDATE
    SET last_sent_at = now(), suppressed_count = 0
    WHERE t.last_sent_at <= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
  RETURNING true INTO v_granted;
  IF v_granted IS NULL THEN
    UPDATE internal.error_alert_email_throttle SET suppressed_count = suppressed_count + 1
    WHERE alert_type = p_alert_type;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_alert_email_slot(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_alert_email_slot(text, int) TO service_role;

DROP FUNCTION IF EXISTS public.claim_pending_error_alerts();
CREATE FUNCTION public.claim_pending_error_alerts()
RETURNS TABLE(id bigint, created_at timestamptz, reason text, error_count int, sample_message text,
              sample_source text, sample_route text, sample_org_id uuid, suppressed_count int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, pg_temp
AS $$
  UPDATE internal.error_alerts a SET delivery_status = 'sending'
  WHERE a.id IN (
    SELECT p.id FROM internal.error_alerts p
    WHERE p.delivery_status = 'pending'
       OR (p.delivery_status = 'sending' AND p.created_at < now() - interval '10 minutes')
    ORDER BY p.created_at LIMIT 5 FOR UPDATE SKIP LOCKED
  )
  RETURNING a.id, a.created_at, a.reason, a.error_count, a.sample_message, a.sample_source,
            a.sample_route, a.sample_org_id, a.suppressed_count;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_error_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_error_alerts() TO service_role;

CREATE OR REPLACE FUNCTION internal.error_logs_alert_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
DECLARE
  s internal.error_alert_settings;
  v_count int;
  v_critical boolean;
  v_last internal.error_alerts;
BEGIN
  SELECT * INTO s FROM internal.error_alert_settings WHERE id = 1;
  IF NOT FOUND THEN
    s.threshold := 10; s.window_minutes := 15; s.debounce_minutes := 30;
  END IF;

  SELECT count(*) INTO v_count FROM public.error_logs
  WHERE created_at > now() - make_interval(mins => s.window_minutes);

  v_critical := coalesce(NEW.source, '') IN ('save_lease', 'month_end', 'stripe_webhook')
    OR coalesce(NEW.message, '') ~* '(save_lease|month[-_ ]end|stripe[-_ ]webhook)';

  IF v_count <= s.threshold AND NOT v_critical THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_last FROM internal.error_alerts ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_last.created_at > now() - make_interval(mins => s.debounce_minutes) THEN
    UPDATE internal.error_alerts SET suppressed_count = suppressed_count + 1 WHERE id = v_last.id;
    RETURN NEW;
  END IF;

  INSERT INTO internal.error_alerts (reason, error_count, sample_message, sample_source, sample_route, sample_org_id)
  VALUES (CASE WHEN v_critical THEN 'critical' ELSE 'threshold' END, v_count,
          left(NEW.message, 500), NEW.source, left(NEW.route, 200), NEW.organization_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION internal.error_logs_alert_check() FROM PUBLIC, anon, authenticated;

/*
# Rate limiting, health check and error alerting

## Plain-English summary
Adds three launch-quality safety features that do not touch any accounting
data, calculations or reports:
1. A durable request counter so edge functions can refuse callers who make
   too many sensitive requests in a short period (HTTP 429).
2. A tiny database "ping" used by the public health endpoint.
3. Automatic error alerts: when many errors arrive in a short time, or any
   error comes from saving a lease, month-end or the Stripe webhook, one
   alert row is recorded (at most one per 30 minutes) for delivery to the
   platform owner and for display in Platform Admin.

## 1. New tables
- `internal.rate_limits`
  - `key` (text) - "<function>:<user id or ip>"
  - `window_start` (timestamptz) - start of the fixed counting window
  - `count` (int) - requests seen in that window
  - primary key (key, window_start)
- `internal.error_alert_settings` (single row, id = 1)
  - `threshold` (int, default 10) - alert when MORE than this many errors
    are logged inside `window_minutes`
  - `window_minutes` (int, default 15)
  - `debounce_minutes` (int, default 30) - minimum gap between alerts
- `internal.error_alerts`
  - `id`, `created_at`
  - `reason` ('threshold' | 'critical')
  - `error_count` - errors in the window when the alert fired
  - `sample_message`, `sample_source`, `sample_route` - the triggering error
  - `suppressed_count` - further qualifying errors swallowed by the debounce
  - `delivery_status` ('pending' | 'sending' | 'sent' | 'failed' | 'not_configured')
  - `delivered_at`, `delivery_error`

## 2. Modified tables
- `public.error_logs`: new nullable column `source` (text) so the app can tag
  errors from save_lease / month_end / stripe_webhook. Existing rows untouched.

## 3. Functions
- `internal.rate_limit_hit(key, limit, window_seconds)` SECURITY DEFINER:
  atomically increments the counter and returns allowed / retry_after.
  Public wrapper `public.rate_limit_hit` is executable by service_role ONLY.
- `public.health_ping()` returns true; service_role only.
- `internal.error_logs_alert_check()` AFTER INSERT trigger on error_logs.
- `public.get_error_alerts(limit)` / `public.get_error_alert_settings()` /
  `public.set_error_alert_threshold(n)` - platform admins only.
- `public.claim_pending_error_alerts()` / `public.mark_error_alert(...)` -
  service_role only (used by the error-alert edge function).

## 4. Security
- RLS enabled on all three new tables with NO policies: they are reachable
  only through the SECURITY DEFINER functions above.
- EXECUTE revoked from PUBLIC/anon/authenticated on internal-only helpers.

## 5. Notes
1. Idempotent: safe to re-run.
2. Old rate-limit windows (older than 1 day) are pruned opportunistically.
*/

CREATE TABLE IF NOT EXISTS internal.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE internal.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON internal.rate_limits (window_start);

CREATE OR REPLACE FUNCTION internal.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
RETURNS TABLE(allowed boolean, current_count int, retry_after int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_count int;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO internal.rate_limits AS r (key, window_start, count)
  VALUES (left(p_key, 200), v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
  RETURNING r.count INTO v_count;

  IF random() < 0.02 THEN
    DELETE FROM internal.rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    GREATEST(1, ceil(extract(epoch FROM (v_window + make_interval(secs => p_window_seconds) - now())))::int);
END;
$$;
REVOKE ALL ON FUNCTION internal.rate_limit_hit(text, int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
RETURNS TABLE(allowed boolean, current_count int, retry_after int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, pg_temp
AS $$ SELECT * FROM internal.rate_limit_hit(p_key, p_limit, p_window_seconds); $$;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.health_ping()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT true; $$;
REVOKE ALL ON FUNCTION public.health_ping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_ping() TO service_role;

ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS source text;
GRANT INSERT (source) ON public.error_logs TO authenticated;
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON public.error_logs (created_at);

CREATE TABLE IF NOT EXISTS internal.error_alert_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  threshold int NOT NULL DEFAULT 10 CHECK (threshold >= 1),
  window_minutes int NOT NULL DEFAULT 15 CHECK (window_minutes >= 1),
  debounce_minutes int NOT NULL DEFAULT 30 CHECK (debounce_minutes >= 1)
);
ALTER TABLE internal.error_alert_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO internal.error_alert_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS internal.error_alerts (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (reason IN ('threshold', 'critical')),
  error_count int NOT NULL,
  sample_message text,
  sample_source text,
  sample_route text,
  suppressed_count int NOT NULL DEFAULT 0,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed', 'not_configured')),
  delivered_at timestamptz,
  delivery_error text
);
ALTER TABLE internal.error_alerts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS error_alerts_created_at_idx ON internal.error_alerts (created_at DESC);

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

  INSERT INTO internal.error_alerts (reason, error_count, sample_message, sample_source, sample_route)
  VALUES (CASE WHEN v_critical THEN 'critical' ELSE 'threshold' END, v_count,
          left(NEW.message, 500), NEW.source, left(NEW.route, 200));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION internal.error_logs_alert_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS error_logs_alert_check ON public.error_logs;
CREATE TRIGGER error_logs_alert_check AFTER INSERT ON public.error_logs
FOR EACH ROW EXECUTE FUNCTION internal.error_logs_alert_check();

CREATE OR REPLACE FUNCTION public.get_error_alerts(p_limit int DEFAULT 50)
RETURNS TABLE(id bigint, created_at timestamptz, reason text, error_count int, sample_message text,
              sample_source text, sample_route text, suppressed_count int, delivery_status text,
              delivered_at timestamptz, delivery_error text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, internal, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.id, a.created_at, a.reason, a.error_count, a.sample_message, a.sample_source,
    a.sample_route, a.suppressed_count, a.delivery_status, a.delivered_at, a.delivery_error
  FROM internal.error_alerts a ORDER BY a.created_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.get_error_alerts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_error_alerts(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_error_alert_settings()
RETURNS TABLE(threshold int, window_minutes int, debounce_minutes int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, internal, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.threshold, s.window_minutes, s.debounce_minutes
  FROM internal.error_alert_settings s WHERE s.id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_error_alert_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_error_alert_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_error_alert_threshold(p_threshold int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_threshold IS NULL OR p_threshold < 1 OR p_threshold > 10000 THEN
    RAISE EXCEPTION 'Threshold must be between 1 and 10000';
  END IF;
  UPDATE internal.error_alert_settings SET threshold = p_threshold WHERE id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.set_error_alert_threshold(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_error_alert_threshold(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_pending_error_alerts()
RETURNS TABLE(id bigint, created_at timestamptz, reason text, error_count int, sample_message text,
              sample_source text, sample_route text)
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
  RETURNING a.id, a.created_at, a.reason, a.error_count, a.sample_message, a.sample_source, a.sample_route;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_error_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_error_alerts() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_error_alert(p_id bigint, p_status text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, pg_temp
AS $$
  UPDATE internal.error_alerts
  SET delivery_status = p_status,
      delivered_at = CASE WHEN p_status = 'sent' THEN now() ELSE delivered_at END,
      delivery_error = left(p_error, 500)
  WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.mark_error_alert(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_error_alert(bigint, text, text) TO service_role;

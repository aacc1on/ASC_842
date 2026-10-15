/*
  # Fix Mutable Search Path on Functions

  ## Problem
  Functions without a fixed search_path are vulnerable to search_path injection —
  a malicious user could create objects in a schema that shadow system objects.
  Setting search_path = '' and fully-qualifying all references eliminates this risk.

  ## Functions Fixed
  - get_lease_summary_stats
  - create_user_profile
  - update_updated_at_column
*/

CREATE OR REPLACE FUNCTION get_lease_summary_stats()
RETURNS TABLE (
  total_rou       numeric,
  total_liability numeric,
  active_count    bigint
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    COALESCE(SUM(rou_asset), 0)       AS total_rou,
    COALESCE(SUM(lease_liability), 0) AS total_liability,
    COUNT(*) FILTER (WHERE status = 'active') AS active_count
  FROM public.leases
  WHERE user_id = (select auth.uid());
$$;

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

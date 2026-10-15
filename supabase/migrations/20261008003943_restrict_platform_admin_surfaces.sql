/*
# Restrict platform-wide user administration to the platform owner

1. Purpose
- Prevent ordinary organization administrators from viewing or changing users in other organizations.
- Restrict the platform-wide user RPC to the platform-owner allow-list.

2. Modified function
- `public.get_all_users_with_plans()` now checks `internal.is_platform_admin()` before returning any rows.
- The return shape and data query are unchanged.

3. Security
- Organization administrators can continue managing users through organization-scoped screens, but cannot use platform-wide administration.
- The platform owner remains the only caller allowed to list all organizations and users.
*/

CREATE OR REPLACE FUNCTION public.get_all_users_with_plans()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  organization_id uuid,
  org_name text,
  plan_key text,
  plan_status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public
AS $$
BEGIN
  IF NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required';
  END IF;

  RETURN QUERY
  SELECT
    up.user_id,
    up.email,
    up.full_name,
    up.role,
    up.organization_id,
    o.name AS org_name,
    s.plan_key,
    s.status AS plan_status,
    s.trial_ends_at,
    s.current_period_end,
    up.created_at
  FROM public.user_profiles up
  LEFT JOIN public.organizations o ON o.id = up.organization_id
  LEFT JOIN LATERAL (
    SELECT plan_key, status, trial_ends_at, current_period_end
    FROM public.subscriptions
    WHERE organization_id = up.organization_id
    ORDER BY created_at DESC
    LIMIT 1
  ) s ON true
  ORDER BY o.name ASC, up.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_users_with_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO authenticated;
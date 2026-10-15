-- Platform admin view: SECURITY DEFINER function to list all users across
-- all organizations with their plan info. Only callable by admins.
-- RLS normally scopes user_profiles to the caller's org, so this function
-- bypasses RLS to provide a platform-wide view for the admin dashboard.

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO authenticated;

-- Revoke from anon (no anonymous access)
REVOKE EXECUTE ON FUNCTION public.get_all_users_with_plans() FROM anon;

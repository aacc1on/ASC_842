/*
# Fix get_all_users_with_plans ambiguous column error

1. Problem
- The Platform Admin page calls get_all_users_with_plans(). The lateral subquery on
  subscriptions used unqualified plan_key / organization_id / created_at, which clash
  with the function's OUT columns of the same names, so every call failed with
  "column reference plan_key is ambiguous".

2. Change
- Same signature and behavior; subscription columns are now table-qualified.

3. Security
- Still SECURITY DEFINER, still gated by internal.is_platform_admin().
- EXECUTE revoked from PUBLIC/anon, granted to authenticated only.
*/

CREATE OR REPLACE FUNCTION public.get_all_users_with_plans()
RETURNS TABLE(user_id uuid, email text, full_name text, role text, organization_id uuid, org_name text, plan_key text, plan_status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
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
    SELECT sub.plan_key, sub.status, sub.trial_ends_at, sub.current_period_end
    FROM public.subscriptions sub
    WHERE sub.organization_id = up.organization_id
    ORDER BY sub.created_at DESC
    LIMIT 1
  ) s ON true
  ORDER BY o.name ASC, up.created_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_all_users_with_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO authenticated;
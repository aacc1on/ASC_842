/*
# Platform admin: show blocked users

1. Changes
- `public.get_all_users_with_plans()` also returns `banned_until` (from auth.users) and
  `is_platform_admin`, so the Platform Admin view can show who is blocked and hide the
  block action for platform administrators.
- Blocking itself is done by the `platform-admin-edit-user` edge function through the
  Supabase Auth admin API (`ban_duration`); no table changes are needed.

2. Security
- Same guard as before: only platform administrators may call the function.
- The return type changes, so the function is dropped and recreated; grants are restored
  exactly as in the previous definition (authenticated only, never anon/PUBLIC).

3. Important notes
- No data is deleted or modified.
*/

DROP FUNCTION IF EXISTS public.get_all_users_with_plans();

CREATE FUNCTION public.get_all_users_with_plans()
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  role text,
  organization_id uuid,
  org_name text,
  plan_key text,
  plan_status text,
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone,
  banned_until timestamp with time zone,
  is_platform_admin boolean
)
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
CASE WHEN s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= now()
  THEN 'expired' ELSE s.status END AS plan_status,
s.trial_ends_at,
s.current_period_end,
up.created_at,
au.banned_until,
EXISTS (SELECT 1 FROM internal.platform_admins pa WHERE pa.user_id = up.user_id) AS is_platform_admin
FROM public.user_profiles up
LEFT JOIN auth.users au ON au.id = up.user_id
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

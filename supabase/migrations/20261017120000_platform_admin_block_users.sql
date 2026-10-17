/*
# Platform admin: blocked users, primary admin, managing platform admins

1. Changes
- `internal.platform_admins.is_primary`: exactly one platform admin can be the primary
  (owner). Only the primary can grant or revoke platform admin for existing users, and
  the primary itself can never be revoked from the app.
- `internal.platform_admin_events`: append-only log of who granted/revoked whom and when.
- `public.is_primary_platform_admin()`: lets the UI show the admin-management actions.
- `public.set_platform_admin(p_user_id, p_make_admin)`: grant/revoke, primary only.
- `public.get_all_users_with_plans()` also returns `banned_until`, `is_platform_admin`
  and `is_primary_admin`. Blocking itself is done by the `platform-admin-edit-user`
  edge function through the Supabase Auth admin API (`ban_duration`).

2. Security
- New tables have RLS enabled with no policies and no grants to anon/authenticated;
  they are only reached through SECURITY DEFINER functions with explicit checks.
- set_platform_admin: caller must be the primary; cannot change self; cannot revoke the
  primary; target must be an existing user. Every change is logged.
- If exactly one platform admin exists and none is primary, that admin becomes primary
  (so an existing single-owner install keeps working). Otherwise set it by SQL.
- `get_all_users_with_plans` changes return type, so it is dropped and recreated with
  the same grants (authenticated only, never anon/PUBLIC).

3. Important notes
- No data is deleted or modified apart from setting the primary flag described above.
*/

ALTER TABLE internal.platform_admins
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_single_primary
  ON internal.platform_admins (is_primary) WHERE is_primary;

UPDATE internal.platform_admins
SET is_primary = true
WHERE (SELECT count(*) FROM internal.platform_admins) = 1
  AND NOT EXISTS (SELECT 1 FROM internal.platform_admins WHERE is_primary);

CREATE TABLE IF NOT EXISTS internal.platform_admin_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('GRANT', 'REVOKE')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE internal.platform_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.platform_admin_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION internal.is_primary_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = auth.uid() AND is_primary) $$;
REVOKE ALL ON FUNCTION internal.is_primary_platform_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION internal.is_primary_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_primary_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT internal.is_primary_platform_admin() $$;
REVOKE ALL ON FUNCTION public.is_primary_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_primary_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_admin(p_user_id uuid, p_make_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT internal.is_primary_platform_admin() THEN
    RAISE EXCEPTION 'Only the primary platform administrator can manage platform administrators'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_make_admin IS NULL THEN
    RAISE EXCEPTION 'User and action are required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own platform administrator access' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_make_admin THEN
    INSERT INTO internal.platform_admins (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO internal.platform_admin_events (actor_user_id, target_user_id, action)
      VALUES (auth.uid(), p_user_id, 'GRANT');
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = p_user_id AND is_primary) THEN
      RAISE EXCEPTION 'The primary platform administrator cannot be removed' USING ERRCODE = '42501';
    END IF;
    DELETE FROM internal.platform_admins WHERE user_id = p_user_id AND NOT is_primary;
    IF FOUND THEN
      INSERT INTO internal.platform_admin_events (actor_user_id, target_user_id, action)
      VALUES (auth.uid(), p_user_id, 'REVOKE');
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_admin(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_admin(uuid, boolean) TO authenticated;

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
  is_platform_admin boolean,
  is_primary_admin boolean
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
(pa.user_id IS NOT NULL) AS is_platform_admin,
COALESCE(pa.is_primary, false) AS is_primary_admin
FROM public.user_profiles up
LEFT JOIN auth.users au ON au.id = up.user_id
LEFT JOIN internal.platform_admins pa ON pa.user_id = up.user_id
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

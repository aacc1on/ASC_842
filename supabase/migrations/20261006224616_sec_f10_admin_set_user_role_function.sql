/*
# F10 - Server-enforced path for changing a user's role

1. Problem
   The user management screen updated `role` and `permissions` on
   `public.user_profiles` directly from the browser. Those columns are
   deliberately excluded from the `authenticated` UPDATE grant, so the
   legitimate admin flow fails, and the obvious "fix" would be to re-grant the
   columns - which is exactly the privilege escalation the grant prevents.

2. Changes
   - Add `public.admin_set_user_role(target_user_id uuid, new_role text,
     new_permissions jsonb)`, a SECURITY DEFINER function that:
     * requires an authenticated caller,
     * requires the caller to be an admin of the target user's organization,
     * refuses to change the caller's own role,
     * validates the role against a fixed list,
     * refuses to remove the organization's last admin.
   - EXECUTE is granted to `authenticated` only.

3. Security
   - Role and permission changes are now authorized server-side and remain
     impossible through a direct table write.
*/

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  target_user_id uuid,
  new_role text,
  new_permissions jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_target_org uuid;
  v_admin_count int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authorized to change roles';
  END IF;

  IF new_role NOT IN ('admin', 'manage', 'view') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF target_user_id = v_caller THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  SELECT organization_id INTO v_caller_org
  FROM public.user_profiles
  WHERE user_id = v_caller AND role = 'admin';

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Not authorized to change roles';
  END IF;

  SELECT organization_id INTO v_target_org
  FROM public.user_profiles
  WHERE user_id = target_user_id;

  IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Not authorized to change roles';
  END IF;

  IF new_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_profiles
    WHERE organization_id = v_caller_org AND role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'An organization must keep at least one admin';
    END IF;
  END IF;

  UPDATE public.user_profiles
  SET role = new_role,
      permissions = COALESCE(new_permissions, permissions)
  WHERE user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, jsonb) TO authenticated;

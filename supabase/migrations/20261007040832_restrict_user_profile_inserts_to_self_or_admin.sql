/*
# Restrict user profile inserts to the caller or an organisation admin

1. Security changes
- `tenant_insert_user_profiles` only checked that the new row's
  `organization_id` matched the caller's organisation. Any signed-in member
  could therefore insert a profile row for an arbitrary auth user id and graft
  that account onto the organisation, bypassing the admin-only invite path.
- The policy now additionally requires that the row is the caller's own profile
  or that the caller is an admin of the organisation.

2. Notes
- Signup profile creation runs in a SECURITY DEFINER trigger and the
  `recreate-user` edge function runs with the service role, so both bypass row
  level security and are unaffected.
- Seat limits continue to be enforced by the plan feature trigger.
*/

DROP POLICY IF EXISTS "tenant_insert_user_profiles" ON public.user_profiles;
CREATE POLICY "tenant_insert_user_profiles"
ON public.user_profiles FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = (SELECT internal.current_org_id())
  AND (
    user_id = (SELECT auth.uid())
    OR internal.is_admin()
  )
);

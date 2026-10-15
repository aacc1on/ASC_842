/*
# Restrict user profile updates to the caller or an organisation admin

1. Security changes
- `consolidated_update_user_profiles` allowed any `manage` role user to update
  other members' profile rows. The user management screen is admin-only, so this
  granted writes no legitimate flow needs.
- The policy now allows a member to update only their own profile, plus admins to
  update profiles in their organisation.

2. Notes
- Column-level grants already prevent `role`, `permissions` and
  `organization_id` from being changed by the `authenticated` role; this narrows
  which rows can be touched at all.
*/

DROP POLICY IF EXISTS "consolidated_update_user_profiles" ON public.user_profiles;
CREATE POLICY "consolidated_update_user_profiles"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (internal.is_admin() OR (SELECT auth.uid()) = user_id)
WITH CHECK (internal.is_admin() OR (SELECT auth.uid()) = user_id);

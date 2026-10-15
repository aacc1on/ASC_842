/*
# Require manage or admin role for company writes

1. Security changes
- `companies` write policies checked only that the client-supplied `user_id`
  matched the caller, so read-only members could create reporting entities in
  the organisation and edit or delete the ones they created.
- Writes now require the `manage` or `admin` role.

2. Notes
- Reads are unchanged; self-signup creates the first user as `admin`, so initial
  company setup is unaffected.
*/

DROP POLICY IF EXISTS "insert_own_companies" ON public.companies;
CREATE POLICY "insert_own_companies"
ON public.companies FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "update_own_companies" ON public.companies;
CREATE POLICY "update_own_companies"
ON public.companies FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "delete_own_companies" ON public.companies;
CREATE POLICY "delete_own_companies"
ON public.companies FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

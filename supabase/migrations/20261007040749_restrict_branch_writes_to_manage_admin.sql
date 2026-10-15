/*
# Require manage or admin role for branch writes

1. Security changes
- `branches` INSERT/UPDATE/DELETE policies accepted a client-supplied `user_id`
  equal to the caller, which let read-only members create, rename and delete
  branches used by every report filter.
- Writes now require the `manage` or `admin` role.

2. Notes
- Reads are unchanged; the lease form (manage/admin only) is the legitimate
  branch creation path.
*/

DROP POLICY IF EXISTS "consolidated_insert_branches" ON public.branches;
CREATE POLICY "consolidated_insert_branches"
ON public.branches FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_branches" ON public.branches;
CREATE POLICY "consolidated_update_branches"
ON public.branches FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_branches" ON public.branches;
CREATE POLICY "consolidated_delete_branches"
ON public.branches FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

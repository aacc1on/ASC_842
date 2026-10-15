/*
# F2 - Add tenant isolation to lessor writes

1. Problem
   `public.lessors` only had an organization predicate on SELECT
   (`tenant_select_lessors`). The INSERT, UPDATE and DELETE policies tested only
   `internal.is_manage_or_admin()`, which answers "is the caller a manager
   somewhere" and says nothing about the row being acted on. A manager of one
   organization could therefore edit or delete lessor records belonging to
   another organization.

2. Changes
   - Add a RESTRICTIVE policy FOR ALL binding every operation on `lessors` to
     the caller's own organization.

3. Security
   - Cross-organization modification and deletion of lessor records is denied.
   - Inserts are unaffected: the existing `set_lessor_organization_id` trigger
     fills `organization_id` from the caller's session.
*/

DROP POLICY IF EXISTS "tenant_isolation_lessors" ON public.lessors;

CREATE POLICY "tenant_isolation_lessors"
ON public.lessors
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (organization_id = (SELECT internal.current_org_id()))
WITH CHECK (organization_id = (SELECT internal.current_org_id()));

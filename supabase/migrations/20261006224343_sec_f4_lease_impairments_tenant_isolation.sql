/*
# F4 - Make tenant isolation on lease_impairments RESTRICTIVE

1. Problem
   `tenant_isolation_lease_impairments` was PERMISSIVE, so it ORed with the
   `consolidated_*_lease_impairments` policies instead of constraining them.
   Those policies test only `internal.is_manage_or_admin()` or ownership of the
   parent lease, so a manager of one organization could read, update and delete
   impairment records belonging to another organization. The table also had no
   trigger filling `organization_id`, so the value came from the request body.

2. Changes
   - Recreate `tenant_isolation_lease_impairments` AS RESTRICTIVE FOR ALL.
   - Attach `internal.set_organization_id()` as a BEFORE INSERT OR UPDATE
     trigger so `organization_id` is taken from the caller's session and can
     never be changed afterwards.

3. Security
   - Cross-organization access to impairment records is denied at the database
     layer, and the organization a new impairment lands in is no longer
     client-controlled.
*/

DROP TRIGGER IF EXISTS set_lease_impairments_organization_id ON public.lease_impairments;
CREATE TRIGGER set_lease_impairments_organization_id
BEFORE INSERT OR UPDATE ON public.lease_impairments
FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

DROP POLICY IF EXISTS "tenant_isolation_lease_impairments" ON public.lease_impairments;

CREATE POLICY "tenant_isolation_lease_impairments"
ON public.lease_impairments
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (organization_id = (SELECT internal.current_org_id()))
WITH CHECK (organization_id = (SELECT internal.current_org_id()));

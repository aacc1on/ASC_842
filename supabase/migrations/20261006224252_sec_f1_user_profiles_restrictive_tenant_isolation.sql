/*
# F1 - Make tenant isolation on user_profiles a RESTRICTIVE policy

1. Problem
   `tenant_isolation_user_profiles` was created as a PERMISSIVE policy FOR ALL.
   PostgreSQL ORs permissive policies together, so instead of constraining the
   `consolidated_*_user_profiles` policies (which carry no organization
   predicate at all), it added an additional allow-path. An admin or manager of
   one organization could therefore read, update and delete user profile rows
   belonging to every other organization in the database.

2. Changes
   - Drop the permissive `tenant_isolation_user_profiles` policy.
   - Recreate it as RESTRICTIVE FOR ALL so the organization check is ANDed with
     every other policy on the table. Access to the caller's own row is kept
     explicitly so a user whose profile has no organization yet can still read
     and edit themselves.
   - Add an explicit PERMISSIVE INSERT policy carrying exactly the condition the
     old permissive policy used for inserts, so the existing insert path keeps
     working.

3. Security
   - Cross-organization read, update and delete of user profiles is now denied
     at the database layer.
*/

DROP POLICY IF EXISTS "tenant_isolation_user_profiles" ON public.user_profiles;

CREATE POLICY "tenant_isolation_user_profiles"
ON public.user_profiles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  organization_id = (SELECT internal.current_org_id())
  OR user_id = (SELECT auth.uid())
)
WITH CHECK (
  organization_id = (SELECT internal.current_org_id())
  OR user_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "tenant_insert_user_profiles" ON public.user_profiles;

CREATE POLICY "tenant_insert_user_profiles"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (organization_id = (SELECT internal.current_org_id()));

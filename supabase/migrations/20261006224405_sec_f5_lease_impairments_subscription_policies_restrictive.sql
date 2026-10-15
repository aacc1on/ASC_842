/*
# F5 - Make the subscription gate on lease_impairments RESTRICTIVE

1. Problem
   `subscription_required_insert/update/delete_lease_impairments` were
   PERMISSIVE, so an active subscription alone satisfied the write check and
   ORed away the role requirement in the consolidated policies. Any signed-in
   member of a subscribed organization, including a read-only `view` user,
   could create, modify or delete impairment records.

2. Changes
   - Recreate the three policies AS RESTRICTIVE.

3. Security
   - Impairment writes now require an active subscription AND the manage/admin
     role AND (per the companion migration) a row in the caller's organization.
*/

DROP POLICY IF EXISTS "subscription_required_insert_lease_impairments" ON public.lease_impairments;
CREATE POLICY "subscription_required_insert_lease_impairments"
ON public.lease_impairments AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_update_lease_impairments" ON public.lease_impairments;
CREATE POLICY "subscription_required_update_lease_impairments"
ON public.lease_impairments AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT internal.org_has_active_subscription()))
WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_delete_lease_impairments" ON public.lease_impairments;
CREATE POLICY "subscription_required_delete_lease_impairments"
ON public.lease_impairments AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT internal.org_has_active_subscription()));

/*
# F3 - Make the subscription gate on lessors RESTRICTIVE

1. Problem
   `subscription_required_insert/update/delete_lessors` were created as
   PERMISSIVE policies. Permissive policies are ORed, so "has an active
   subscription" became an alternative way to pass the write check instead of a
   precondition for it. Any signed-in member of a subscribed organization -
   including a read-only `view` user - could insert, update or delete lessor
   records.

2. Changes
   - Recreate the three policies AS RESTRICTIVE so an active subscription is
     required in addition to, not instead of, the role check.

3. Security
   - Write access to lessors now requires both a manage/admin role and an
     active subscription, and (per the companion migration) the row must belong
     to the caller's organization.
*/

DROP POLICY IF EXISTS "subscription_required_insert_lessors" ON public.lessors;
CREATE POLICY "subscription_required_insert_lessors"
ON public.lessors AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_update_lessors" ON public.lessors;
CREATE POLICY "subscription_required_update_lessors"
ON public.lessors AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT internal.org_has_active_subscription()))
WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_delete_lessors" ON public.lessors;
CREATE POLICY "subscription_required_delete_lessors"
ON public.lessors AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT internal.org_has_active_subscription()));

/*
# Require manage or admin role for contract cancellation writes

1. Security changes
- `contract_cancellations` INSERT/UPDATE/DELETE policies previously allowed any
  signed-in organisation member to write a row as long as the request body set
  `user_id` to their own id. Because `user_id` is client supplied, read-only
  (`view`) members could record, edit and delete lease cancellations.
- The self-ownership branch is removed; writes now require the `manage` or
  `admin` role, matching the sibling `contract_modifications` table.

2. Notes
- Reads are unchanged.
- Existing tenant isolation and subscription restrictive policies still apply.
*/

DROP POLICY IF EXISTS "consolidated_insert_contract_cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_insert_contract_cancellations"
ON public.contract_cancellations FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_update_contract_cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_update_contract_cancellations"
ON public.contract_cancellations FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "consolidated_delete_contract_cancellations" ON public.contract_cancellations;
CREATE POLICY "consolidated_delete_contract_cancellations"
ON public.contract_cancellations FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

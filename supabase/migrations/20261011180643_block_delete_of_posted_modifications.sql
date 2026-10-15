/*
# Block deleting posted modifications and cancellations

1. Problem
- Deleting a contract modification or cancellation whose accounting was already
  posted left its journal entries behind (modification_id set to NULL), and the
  lease balances/schedule stayed changed. This produced orphaned duplicate entries.

2. Changes
- New trigger function `internal.prevent_delete_posted_contract_change()`.
- BEFORE DELETE triggers on `contract_modifications` (accounting_posted = true)
  and `contract_cancellations` (derecognition_posted = true) raise an error.

3. Notes
- Deleting the whole lease still works: during the cascade the parent lease row
  is already gone, so the trigger lets the child row be removed.
- No data or RLS changes.
*/

CREATE OR REPLACE FUNCTION internal.prevent_delete_posted_contract_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_posted boolean;
BEGIN
  IF TG_TABLE_NAME = 'contract_modifications' THEN
    v_posted := COALESCE((to_jsonb(OLD)->>'accounting_posted')::boolean, false);
  ELSE
    v_posted := COALESCE((to_jsonb(OLD)->>'derecognition_posted')::boolean, false);
  END IF;

  IF v_posted AND EXISTS (SELECT 1 FROM public.leases WHERE id = OLD.lease_id) THEN
    RAISE EXCEPTION 'This item has already been posted to the books and cannot be deleted. Record a new modification to adjust it instead.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION internal.prevent_delete_posted_contract_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_delete_posted_modification ON public.contract_modifications;
CREATE TRIGGER trg_prevent_delete_posted_modification
  BEFORE DELETE ON public.contract_modifications
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_delete_posted_contract_change();

DROP TRIGGER IF EXISTS trg_prevent_delete_posted_cancellation ON public.contract_cancellations;
CREATE TRIGGER trg_prevent_delete_posted_cancellation
  BEFORE DELETE ON public.contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_delete_posted_contract_change();

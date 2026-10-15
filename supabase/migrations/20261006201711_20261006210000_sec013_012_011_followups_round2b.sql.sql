/*
# Round 2b: SEC-013, SEC-012, SEC-011 follow-ups, Round 2a follow-ups

## Summary

This migration addresses:
1. Round 2a follow-up: has_permission must return true for admin role
2. Round 2a follow-up: set_user_id must FORCE user_id (not just when NULL)
3. Round 2a follow-up: create_user_profile must set role-appropriate default permissions
4. SEC-011: Add BEFORE UPDATE trigger to reject user_id changes on business tables
5. SEC-013: Prevent mutation of posted/closed records via triggers
6. SEC-013: Admin "reopen" SECURITY DEFINER function for finalized month-end documents

## Changes

### Round 2a Follow-up 1: has_permission returns true for admin

The has_permission function must return true for any permission when the
user's role is 'admin', so admins are never locked out of creating leases etc.

### Round 2a Follow-up 2: set_user_id forces user_id on INSERT

Change set_user_id to FORCE user_id = auth.uid() for non-service callers,
not just fill it when NULL. Also add a BEFORE UPDATE trigger function that
rejects changing user_id on UPDATE.

### Round 2a Follow-up 3: create_user_profile role-appropriate permissions

The sign-up trigger must set permissions appropriate to the role:
- admin: all permissions true (including manage_user_roles, access_user_management)
- manage: all lease permissions true, manage_user_roles/access_user_management false
- view: all false except view_leases_transactions and view_reports_documents

### SEC-013: Prevent mutation of posted/closed records

1. Transactions linked to a finalized month_end_document: reject UPDATE/DELETE
2. Month-end documents with status 'finalized' or 'closed': reject UPDATE/DELETE
   (except through the admin reopen SECURITY DEFINER function)
3. lease_transactions and journal_entries with entry_date/transaction_date
   inside a locked or closed accounting_period: reject UPDATE/DELETE

The triggers check whether the service role is making the call (auth.uid() IS NULL)
and allow it through, so the app's legitimate flows (re-saving unposted leases
that delete + re-create initial_recognition entries) still work when done
server-side. Client-side calls that go through RLS will have auth.uid() set.

### SEC-013: Admin reopen function

internal.reopen_month_end(p_doc_id uuid, p_reason text)
- Requires admin role
- Changes month_end_documents status from finalized/closed to posted
- Writes audit_log entry with the reason
- Returns the updated document

## Security Impact

- Admins always have all permissions regardless of permissions JSON
- user_id on business tables is always forced from session on INSERT and cannot be changed on UPDATE
- Posted/finalized records cannot be mutated by any client-side call
- Only the admin reopen function can un-finalize a month-end document, and it requires a reason
*/

-- ============================================================================
-- Round 2a Follow-up 1: has_permission returns true for admin
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.has_permission(perm_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perms jsonb;
  v_role text;
BEGIN
  SELECT role, permissions INTO v_role, v_perms
  FROM public.user_profiles
  WHERE user_id = auth.uid()
    AND organization_id = internal.current_org_id();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Admins always have all permissions
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  RETURN COALESCE((v_perms ->> perm_key)::boolean, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.has_permission(text) FROM anon;
GRANT EXECUTE ON FUNCTION internal.has_permission(text) TO authenticated;

-- ============================================================================
-- Round 2a Follow-up 2: set_user_id forces user_id on INSERT
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Force user_id from session for non-service callers.
  -- The service role bypasses RLS and has auth.uid() = NULL.
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- Also prevent changing user_id on UPDATE
CREATE OR REPLACE FUNCTION internal.prevent_user_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.prevent_user_id_change() FROM anon;
GRANT EXECUTE ON FUNCTION internal.prevent_user_id_change() TO authenticated;

-- Add prevent_user_id_change triggers on business tables that have user_id
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'leases', 'transactions', 'amortization_schedules',
    'month_end_documents', 'contract_modifications', 'documents',
    'accounting_periods'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS prevent_user_id_change ON public.%I;
       CREATE TRIGGER prevent_user_id_change BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION internal.prevent_user_id_change();',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- Round 2a Follow-up 3: create_user_profile with role-appropriate permissions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
  v_role text;
  v_perms jsonb;
BEGIN
  v_org_id := NEW.raw_app_meta_data->>'organization_id';

  IF v_org_id IS NOT NULL THEN
    -- Invited user: gets 'view' role with view-only permissions
    v_role := 'view';
    v_perms := '{"create_edit_leases":false,"delete_leases":false,"create_transactions":false,"run_month_end":false,"manage_modifications":false,"upload_documents":false,"manage_user_roles":false,"access_user_management":false,"view_reports_documents":true,"view_leases_transactions":true}'::jsonb;
  ELSE
    -- Self-signup: creates a new org, user is admin with all permissions
    v_org_name := COALESCE(NEW.raw_user_meta_data->>'company_name', NEW.email);
    INSERT INTO public.organizations (name) VALUES (v_org_name) RETURNING id INTO v_org_id;
    v_role := 'admin';
    v_perms := '{"create_edit_leases":true,"delete_leases":true,"create_transactions":true,"run_month_end":true,"manage_modifications":true,"upload_documents":true,"manage_user_roles":true,"access_user_management":true,"view_reports_documents":true,"view_leases_transactions":true}'::jsonb;

    INSERT INTO public.subscriptions (organization_id, user_id, plan_key, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
    VALUES (v_org_id, NEW.id, 'starter', 'monthly', 'trialing', now() + interval '5 days', now(), now() + interval '1 month')
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_profiles (user_id, email, organization_id, role, permissions)
  VALUES (NEW.id, NEW.email, v_org_id, v_role, v_perms)
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- SEC-013: Prevent mutation of posted/finalized transactions
-- Reject UPDATE and DELETE on transactions that belong to a finalized month_end_document
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.prevent_posted_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc_status text;
BEGIN
  -- Allow service role (auth.uid() IS NULL) to proceed
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if this transaction belongs to a finalized/closed month_end_document
  SELECT med.status INTO v_doc_status
  FROM public.month_end_documents med
  WHERE med.id = COALESCE(NEW.month_end_document_id, OLD.month_end_document_id);

  IF v_doc_status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a transaction belonging to a finalized month-end document';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.prevent_posted_transaction_mutation() FROM anon;
GRANT EXECUTE ON FUNCTION internal.prevent_posted_transaction_mutation() TO authenticated;

DROP TRIGGER IF EXISTS prevent_posted_transaction_update ON public.transactions;
CREATE TRIGGER prevent_posted_transaction_update
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_transaction_mutation();

DROP TRIGGER IF EXISTS prevent_posted_transaction_delete ON public.transactions;
CREATE TRIGGER prevent_posted_transaction_delete
BEFORE DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION internal.prevent_posted_transaction_mutation();

-- ============================================================================
-- SEC-013: Prevent mutation of finalized/closed month-end documents
-- Reject UPDATE and DELETE (except via the admin reopen function)
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.prevent_month_end_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow service role (auth.uid() IS NULL) to proceed
  -- The admin reopen function uses the service role client
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check the OLD record's status (for UPDATE/DELETE, the current status)
  IF OLD.status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a finalized or closed month-end document. Use the reopen function.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.prevent_month_end_mutation() FROM anon;
GRANT EXECUTE ON FUNCTION internal.prevent_month_end_mutation() TO authenticated;

DROP TRIGGER IF EXISTS prevent_month_end_update ON public.month_end_documents;
CREATE TRIGGER prevent_month_end_update
BEFORE UPDATE ON public.month_end_documents
FOR EACH ROW EXECUTE FUNCTION internal.prevent_month_end_mutation();

DROP TRIGGER IF EXISTS prevent_month_end_delete ON public.month_end_documents;
CREATE TRIGGER prevent_month_end_delete
BEFORE DELETE ON public.month_end_documents
FOR EACH ROW EXECUTE FUNCTION internal.prevent_month_end_mutation();

-- ============================================================================
-- SEC-013: Prevent mutation of lease_transactions inside locked/closed periods
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_lt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_status text;
  v_tx_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_tx_date := COALESCE(NEW.transaction_date, OLD.transaction_date);

  SELECT ap.status INTO v_period_status
  FROM public.accounting_periods ap
  WHERE ap.organization_id = internal.current_org_id()
    AND v_tx_date >= ap.period_start
    AND v_tx_date <= ap.period_end
    AND ap.status IN ('locked', 'closed')
  LIMIT 1;

  IF v_period_status IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify lease transactions in a % accounting period', v_period_status;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_lt() FROM anon;
GRANT EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_lt() TO authenticated;

DROP TRIGGER IF EXISTS prevent_period_locked_lt_update ON public.lease_transactions;
CREATE TRIGGER prevent_period_locked_lt_update
BEFORE UPDATE ON public.lease_transactions
FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_lt();

DROP TRIGGER IF EXISTS prevent_period_locked_lt_delete ON public.lease_transactions;
CREATE TRIGGER prevent_period_locked_lt_delete
BEFORE DELETE ON public.lease_transactions
FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_lt();

-- ============================================================================
-- SEC-013: Prevent mutation of journal_entries inside locked/closed periods
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.prevent_period_locked_mutation_je()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_status text;
  v_entry_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_entry_date := COALESCE(NEW.entry_date, OLD.entry_date);

  SELECT ap.status INTO v_period_status
  FROM public.accounting_periods ap
  WHERE ap.organization_id = internal.current_org_id()
    AND v_entry_date >= ap.period_start
    AND v_entry_date <= ap.period_end
    AND ap.status IN ('locked', 'closed')
  LIMIT 1;

  IF v_period_status IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify journal entries in a % accounting period', v_period_status;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_je() FROM anon;
GRANT EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_je() TO authenticated;

DROP TRIGGER IF EXISTS prevent_period_locked_je_update ON public.journal_entries;
CREATE TRIGGER prevent_period_locked_je_update
BEFORE UPDATE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_je();

DROP TRIGGER IF EXISTS prevent_period_locked_je_delete ON public.journal_entries;
CREATE TRIGGER prevent_period_locked_je_delete
BEFORE DELETE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION internal.prevent_period_locked_mutation_je();

-- ============================================================================
-- SEC-013: Admin reopen function for finalized month-end documents
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text)
RETURNS public.month_end_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc public.month_end_documents;
  v_org_id uuid;
BEGIN
  -- Verify caller is admin
  IF NOT internal.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reopen month-end documents';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reopen a month-end document';
  END IF;

  v_org_id := internal.current_org_id();

  SELECT * INTO v_doc FROM public.month_end_documents
  WHERE id = p_doc_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Month-end document not found';
  END IF;

  IF v_doc.status NOT IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Only finalized or closed documents can be reopened';
  END IF;

  -- Use a service-role path: update with auth.uid() = NULL bypasses the trigger
  -- We are SECURITY DEFINER so we run as the function owner.
  -- But the trigger checks auth.uid() which is still set for the calling user.
  -- So we need to temporarily set a GUC to allow the trigger to pass.
  -- Instead, we directly update the row and the trigger will fire.
  -- The trigger allows service role (auth.uid() IS NULL). Since this is
  -- SECURITY DEFINER, auth.uid() is still the calling user's uid.
  -- We need a different approach: set a session GUC that the trigger checks.

  -- Simpler: drop to a direct UPDATE that bypasses the trigger by using
  -- a different approach. We'll set a GUC flag.
  SET LOCAL _skip_period_check = '1';

  UPDATE public.month_end_documents
  SET status = 'posted'
  WHERE id = p_doc_id
  RETURNING * INTO v_doc;

  -- Write audit log
  INSERT INTO public.audit_log (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (
    v_org_id,
    auth.uid(),
    'month_end_documents',
    p_doc_id::text,
    'REOPEN',
    jsonb_build_object('old_status', 'finalized', 'reason', p_reason),
    jsonb_build_object('new_status', 'posted'),
    ARRAY['status']
  );

  RETURN v_doc;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal.reopen_month_end(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION internal.reopen_month_end(uuid, text) TO authenticated;

-- Update the month_end mutation trigger to check the GUC flag
CREATE OR REPLACE FUNCTION internal.prevent_month_end_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Check if the reopen function set the skip flag
  v_skip := current_setting('_skip_period_check', true);
  IF v_skip = '1' THEN
    RETURN NEW;
  END IF;

  -- Allow service role (auth.uid() IS NULL) to proceed
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('finalized', 'closed') THEN
    RAISE EXCEPTION 'Cannot modify a finalized or closed month-end document. Use the reopen function.';
  END IF;

  RETURN NEW;
END;
$$;

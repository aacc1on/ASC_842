/*
# Finance classification inputs required + override reason

1. Modified Tables
- `leases`: new nullable column `classification_override_reason` (text). It records why a lease is kept
  as Finance when none of the five ASC 842-10-25-2 criteria is met. Changes are captured by the existing
  `audit_log_leases` trigger.

2. New guard (trigger `require_finance_classification_inputs`, BEFORE INSERT OR UPDATE on leases)
- A recognized (not short-term exempt) Finance lease must have an asset fair value (`asset_market_value` > 0)
  and an economic life (`asset_economic_life_years` > 0)
  - on INSERT, and
  - on UPDATE when the classification, fair value or economic life is changed.
- Existing rows are not changed and stay readable; other updates (status, modifications, month-end) are not blocked.

3. New function `set_classification_override(p_lease_id, p_reason)`
- SECURITY DEFINER, callable by authenticated users only; requires lease-edit permission and same organization.
- Stores the trimmed reason (empty clears it).

4. Important notes
- No existing lease data or classification is modified.
*/

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS classification_override_reason text;

CREATE OR REPLACE FUNCTION internal.require_finance_classification_inputs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lease_classification <> 'finance'
     OR COALESCE(NEW.accounting_treatment, 'recognized') = 'short_term_exemption' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.lease_classification IS NOT DISTINCT FROM OLD.lease_classification
     AND NEW.asset_market_value IS NOT DISTINCT FROM OLD.asset_market_value
     AND NEW.asset_economic_life_years IS NOT DISTINCT FROM OLD.asset_economic_life_years THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.asset_market_value, 0) <= 0 OR COALESCE(NEW.asset_economic_life_years, 0) <= 0 THEN
    RAISE EXCEPTION 'Finance classification requires the asset''s fair value and useful life';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_finance_classification_inputs ON public.leases;
CREATE TRIGGER require_finance_classification_inputs
  BEFORE INSERT OR UPDATE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION internal.require_finance_classification_inputs();

CREATE OR REPLACE FUNCTION public.set_classification_override(p_lease_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be authenticated';
  END IF;
  IF NOT internal.is_manage_or_admin() OR NOT internal.has_permission('create_edit_leases') THEN
    RAISE EXCEPTION 'You do not have permission to create or edit leases';
  END IF;

  UPDATE public.leases
     SET classification_override_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_lease_id
     AND organization_id = internal.current_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_classification_override(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_classification_override(uuid, text) TO authenticated;
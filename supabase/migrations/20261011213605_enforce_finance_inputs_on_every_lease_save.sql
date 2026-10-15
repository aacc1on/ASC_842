/*
# Enforce finance classification inputs on every lease save

1. Changes
- `save_lease` now marks its transaction (`app.saving_lease = on`, transaction-local) before writing.
- `require_finance_classification_inputs` trigger: any insert or update made through `save_lease`
  (i.e. creating or editing a lease from the lease form) of a recognized Finance lease now requires
  fair value and economic life, even if those values were not changed in the edit.
- Other updates (month-end, modifications, status changes) are still only checked when classification,
  fair value or economic life change, so existing rows stay readable and other workflows are unaffected.

2. Important notes
- No data is modified.
*/

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_lease';

  IF position('app.saving_lease' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_new := regexp_replace(
    v_def,
    E'\\nBEGIN\\n',
    E'\nBEGIN\nPERFORM set_config(''app.saving_lease'', ''on'', true);\n'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'save_lease body marker not found';
  END IF;

  EXECUTE v_new;
END
$mig$;

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
     AND COALESCE(current_setting('app.saving_lease', true), '') <> 'on'
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
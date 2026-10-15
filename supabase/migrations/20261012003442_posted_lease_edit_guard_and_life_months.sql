/*
# Posted-lease edit guard + economic life in whole months

1. New column
- `leases.asset_economic_life_months` (integer) - the asset's economic (useful) life in whole months.
  Backfilled as round(asset_economic_life_years * 12).

2. Economic life years is now read-only
- New BEFORE INSERT/UPDATE trigger `a01_sync_economic_life` on leases:
  - INSERT without months derives months from years (older callers keep working).
  - UPDATE that changes only the years column is rejected (years is read-only for one release).
  - Years is always recomputed as months / 12.

3. Finance classification inputs check uses months
- `internal.require_finance_classification_inputs()` now requires asset_economic_life_months > 0.

4. save_lease
- Writes `asset_economic_life_months` (falls back to years * 12 for older callers).
- On EDIT of a lease that overlaps a locked (posted) month:
  - Missing keys are filled from the stored lease, so a payload with only descriptive fields is accepted.
  - Any change to an accounting input (dates, term, payments, frequency/timing, rates, classification,
    treatment, components, options, IDC, incentives, prepaid, RVG, purchase option, fair value, economic life,
    measured ROU/liability, company) is rejected with
    "This lease has posted periods. Use Contract Modification to change it." (changed fields in DETAIL).
  - Payment schedule, amortization schedule and initial recognition rows are left untouched.
- Unposted leases keep the replace-everything behaviour.

5. get_lease_portfolio_totals
- "Missing classification data" filter uses months instead of years.

Security: no policy changes; save_lease remains SECURITY DEFINER with the same auth/permission/org checks.
*/

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS asset_economic_life_months integer;

UPDATE public.leases
SET asset_economic_life_months = round(COALESCE(asset_economic_life_years, 0) * 12)::int
WHERE asset_economic_life_months IS NULL;

CREATE OR REPLACE FUNCTION internal.sync_economic_life_years()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.asset_economic_life_months IS NULL THEN
      NEW.asset_economic_life_months := round(COALESCE(NEW.asset_economic_life_years, 0) * 12)::int;
    END IF;
  ELSIF NEW.asset_economic_life_years IS DISTINCT FROM OLD.asset_economic_life_years
    AND NEW.asset_economic_life_months IS NOT DISTINCT FROM OLD.asset_economic_life_months THEN
    RAISE EXCEPTION 'asset_economic_life_years is read-only; update asset_economic_life_months instead';
  END IF;
  NEW.asset_economic_life_months := COALESCE(NEW.asset_economic_life_months, 0);
  IF NEW.asset_economic_life_months < 0 THEN
    RAISE EXCEPTION 'Economic life cannot be negative';
  END IF;
  NEW.asset_economic_life_years := round(NEW.asset_economic_life_months / 12.0, 4);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a01_sync_economic_life ON public.leases;
CREATE TRIGGER a01_sync_economic_life
  BEFORE INSERT OR UPDATE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION internal.sync_economic_life_years();

CREATE OR REPLACE FUNCTION internal.require_finance_classification_inputs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
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
  AND NEW.asset_economic_life_months IS NOT DISTINCT FROM OLD.asset_economic_life_months THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.asset_market_value, 0) <= 0 OR COALESCE(NEW.asset_economic_life_months, 0) <= 0 THEN
    RAISE EXCEPTION 'Finance classification requires the asset''s fair value and useful life';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.get_lease_portfolio_totals'::regproc);
  IF v_def LIKE '%asset_economic_life_years%' THEN
    EXECUTE replace(v_def, 'asset_economic_life_years', 'asset_economic_life_months');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_lease(p_lease jsonb, p_payment_schedule jsonb DEFAULT '[]'::jsonb, p_amortization jsonb DEFAULT '[]'::jsonb, p_recognition jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_accounting_keys constant text[] := ARRAY[
    'company_id','lease_start_date','lease_end_date','lease_term_months','payment_amount','payment_frequency',
    'payment_timing','payment_day_of_month','incremental_borrowing_rate','implicit_rate',
    'implicit_rate_readily_determinable','risk_free_rate','discount_rate_method','discount_rate',
    'accounting_treatment','lease_component_amount','nonlease_component_amount','component_policy',
    'purchase_option_reasonably_certain','renewal_months_reasonably_certain','renewal_payment_amount',
    'termination_option_month','termination_option_reasonably_certain','termination_penalty_amount',
    'prepaid_lease_payments','lease_classification','initial_direct_costs','lease_incentives',
    'transfer_ownership','purchase_option','purchase_option_price','asset_fair_value','asset_market_value',
    'asset_economic_life_months','specialized_asset','residual_value_guarantee','rvg_probable_amount',
    'rou_asset','lease_liability'];
  v_empty constant jsonb[] := ARRAY['null'::jsonb, '0'::jsonb, 'false'::jsonb, '""'::jsonb];
  v_lease_id uuid;
  v_is_edit boolean;
  v_caller_org_id uuid;
  v_user_id uuid;
  v_posted_through date;
  v_old leases%ROWTYPE;
  v_new leases%ROWTYPE;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_key text;
  v_o jsonb;
  v_n jsonb;
  v_idx int;
  v_pay_row jsonb;
  v_amort_row jsonb;
  v_recog_row jsonb;
  v_company_id uuid;
  v_branch_id uuid;
  v_fixed_asset_type_id uuid;
  v_short_term_policy_election_id uuid;
  v_risk_free_policy_election_id uuid;
  v_component_policy_election_id uuid;
  v_life_months int;
BEGIN
  PERFORM set_config('app.saving_lease', 'on', true);

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be authenticated to save a lease';
  END IF;
  IF NOT internal.is_manage_or_admin() THEN
    RAISE EXCEPTION 'You do not have permission to create or edit leases';
  END IF;
  IF NOT internal.has_permission('create_edit_leases') THEN
    RAISE EXCEPTION 'You do not have permission to create or edit leases';
  END IF;
  v_caller_org_id := internal.current_org_id();
  IF NOT (internal.org_has_active_subscription() OR internal.is_platform_admin()) THEN
    RAISE EXCEPTION 'Your subscription is not active. Please subscribe to continue.';
  END IF;

  v_lease_id := (p_lease->>'id')::uuid;
  v_is_edit := v_lease_id IS NOT NULL;

  IF v_is_edit THEN
    SELECT * INTO v_old FROM leases WHERE id = v_lease_id;
    IF NOT FOUND OR v_old.organization_id IS DISTINCT FROM v_caller_org_id THEN
      RAISE EXCEPTION 'Lease not found in your organization';
    END IF;
    SELECT max(ap.period_start) INTO v_posted_through
    FROM accounting_periods ap
    WHERE ap.organization_id = v_caller_org_id
      AND ap.status IN ('locked', 'closed')
      AND ap.period_end >= v_old.lease_start_date
      AND ap.period_start <= COALESCE(v_old.lease_end_date, ap.period_start);
    IF v_posted_through IS NOT NULL THEN
      p_lease := (to_jsonb(v_old) - 'id') || p_lease;
    END IF;
  END IF;

  v_company_id := NULLIF(p_lease->>'company_id', '')::uuid;
  v_branch_id := NULLIF(p_lease->>'branch_id', '')::uuid;
  v_fixed_asset_type_id := NULLIF(p_lease->>'fixed_asset_type_id', '')::uuid;
  v_short_term_policy_election_id := NULLIF(p_lease->>'short_term_policy_election_id', '')::uuid;
  v_risk_free_policy_election_id := NULLIF(p_lease->>'risk_free_policy_election_id', '')::uuid;
  v_component_policy_election_id := NULLIF(p_lease->>'component_policy_election_id', '')::uuid;
  v_life_months := COALESCE(
    NULLIF(p_lease->>'asset_economic_life_months', '')::numeric,
    round(NULLIF(p_lease->>'asset_economic_life_years', '')::numeric * 12),
    0)::int;

  IF v_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = v_company_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid company: does not belong to your organization';
  END IF;
  IF v_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches WHERE id = v_branch_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid branch: does not belong to your organization';
  END IF;
  IF v_fixed_asset_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fixed_asset_types WHERE id = v_fixed_asset_type_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid asset type: does not belong to your organization';
  END IF;
  IF v_short_term_policy_election_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounting_policy_elections WHERE id = v_short_term_policy_election_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
  END IF;
  IF v_risk_free_policy_election_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounting_policy_elections WHERE id = v_risk_free_policy_election_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
  END IF;
  IF v_component_policy_election_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounting_policy_elections WHERE id = v_component_policy_election_id AND organization_id = v_caller_org_id) THEN
    RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
  END IF;

  IF v_is_edit THEN
    UPDATE leases SET
      company_id                    = v_company_id,
      branch_id                     = v_branch_id,
      fixed_asset_type_id           = v_fixed_asset_type_id,
      lease_name                    = p_lease->>'lease_name',
      lease_description             = COALESCE(p_lease->>'lease_description', ''),
      lessor_name                   = p_lease->>'lessor_name',
      lessor_type                   = p_lease->>'lessor_type',
      lease_start_date              = (p_lease->>'lease_start_date')::date,
      lease_end_date                = (p_lease->>'lease_end_date')::date,
      lease_term_months             = (p_lease->>'lease_term_months')::int,
      payment_amount                = (p_lease->>'payment_amount')::numeric,
      payment_frequency             = p_lease->>'payment_frequency',
      incremental_borrowing_rate    = (p_lease->>'incremental_borrowing_rate')::numeric,
      implicit_rate                 = NULLIF(p_lease->>'implicit_rate', '')::numeric,
      implicit_rate_readily_determinable = COALESCE((p_lease->>'implicit_rate_readily_determinable')::boolean, false),
      risk_free_rate                = NULLIF(p_lease->>'risk_free_rate', '')::numeric,
      risk_free_rate_source         = NULLIF(p_lease->>'risk_free_rate_source', ''),
      risk_free_rate_date           = NULLIF(p_lease->>'risk_free_rate_date', '')::date,
      discount_rate_method          = p_lease->>'discount_rate_method',
      discount_rate                 = NULLIF(p_lease->>'discount_rate', '')::numeric,
      rate_source                   = NULLIF(p_lease->>'rate_source', ''),
      rate_date                     = NULLIF(p_lease->>'rate_date', '')::date,
      risk_free_policy_election_id  = v_risk_free_policy_election_id,
      accounting_treatment          = p_lease->>'accounting_treatment',
      short_term_policy_election_id = v_short_term_policy_election_id,
      lease_component_amount        = COALESCE(NULLIF(p_lease->>'lease_component_amount', '')::numeric, 0),
      nonlease_component_amount     = COALESCE(NULLIF(p_lease->>'nonlease_component_amount', '')::numeric, 0),
      component_policy              = p_lease->>'component_policy',
      component_policy_election_id  = v_component_policy_election_id,
      related_party                 = COALESCE((p_lease->>'related_party')::boolean, false),
      related_party_name            = NULLIF(p_lease->>'related_party_name', ''),
      purchase_option_reasonably_certain = COALESCE((p_lease->>'purchase_option_reasonably_certain')::boolean, false),
      renewal_months_reasonably_certain  = COALESCE(NULLIF(p_lease->>'renewal_months_reasonably_certain', '')::int, 0),
      renewal_payment_amount        = NULLIF(p_lease->>'renewal_payment_amount', '')::numeric,
      termination_option_month      = NULLIF(p_lease->>'termination_option_month', '')::int,
      termination_option_reasonably_certain = COALESCE((p_lease->>'termination_option_reasonably_certain')::boolean, false),
      termination_penalty_amount    = COALESCE(NULLIF(p_lease->>'termination_penalty_amount', '')::numeric, 0),
      prepaid_lease_payments        = COALESCE(NULLIF(p_lease->>'prepaid_lease_payments', '')::numeric, 0),
      lease_classification          = p_lease->>'lease_classification',
      initial_direct_costs          = COALESCE(NULLIF(p_lease->>'initial_direct_costs', '')::numeric, 0),
      lease_incentives              = COALESCE(NULLIF(p_lease->>'lease_incentives', '')::numeric, 0),
      payment_timing                = p_lease->>'payment_timing',
      payment_day_of_month          = NULLIF(p_lease->>'payment_day_of_month', '')::int,
      transfer_ownership            = COALESCE((p_lease->>'transfer_ownership')::boolean, false),
      purchase_option               = COALESCE((p_lease->>'purchase_option')::boolean, false),
      purchase_option_price         = COALESCE(NULLIF(p_lease->>'purchase_option_price', '')::numeric, 0),
      asset_fair_value              = COALESCE(NULLIF(p_lease->>'asset_fair_value', '')::numeric, 0),
      asset_market_value            = COALESCE(NULLIF(p_lease->>'asset_market_value', '')::numeric, 0),
      asset_economic_life_months    = v_life_months,
      specialized_asset             = COALESCE((p_lease->>'specialized_asset')::boolean, false),
      residual_value_guarantee      = COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
      rvg_probable_amount           = COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
      auto_classified               = COALESCE((p_lease->>'auto_classified')::boolean, false),
      rou_asset                     = COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
      lease_liability               = COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
      status                        = COALESCE(p_lease->>'status', 'active'),
      updated_at                    = now()
    WHERE id = v_lease_id
    RETURNING * INTO v_new;

    IF v_posted_through IS NOT NULL THEN
      v_old_json := to_jsonb(v_old);
      v_new_json := to_jsonb(v_new);
      FOREACH v_key IN ARRAY v_accounting_keys LOOP
        v_o := COALESCE(v_old_json->v_key, 'null'::jsonb);
        v_n := COALESCE(v_new_json->v_key, 'null'::jsonb);
        IF v_o IS DISTINCT FROM v_n AND NOT (v_o = ANY (v_empty) AND v_n = ANY (v_empty)) THEN
          v_changed := v_changed || v_key;
        END IF;
      END LOOP;
      IF cardinality(v_changed) > 0 THEN
        RAISE EXCEPTION 'This lease has posted periods. Use Contract Modification to change it.'
          USING DETAIL = 'Posted through ' || to_char(v_posted_through, 'YYYY-MM') || '; changed: ' || array_to_string(v_changed, ', ');
      END IF;
    END IF;
  ELSE
    INSERT INTO leases (
      organization_id, user_id, company_id, branch_id, fixed_asset_type_id,
      lease_name, lease_description, lessor_name, lessor_type,
      lease_start_date, lease_end_date, lease_term_months,
      payment_amount, payment_frequency, incremental_borrowing_rate,
      implicit_rate, implicit_rate_readily_determinable,
      risk_free_rate, risk_free_rate_source, risk_free_rate_date,
      discount_rate_method, discount_rate, rate_source, rate_date,
      risk_free_policy_election_id, accounting_treatment, short_term_policy_election_id,
      lease_component_amount, nonlease_component_amount, component_policy, component_policy_election_id,
      related_party, related_party_name,
      purchase_option_reasonably_certain, renewal_months_reasonably_certain, renewal_payment_amount,
      termination_option_month, termination_option_reasonably_certain, termination_penalty_amount,
      prepaid_lease_payments, lease_classification, initial_direct_costs, lease_incentives,
      payment_timing, payment_day_of_month,
      transfer_ownership, purchase_option, purchase_option_price,
      asset_fair_value, asset_market_value, asset_economic_life_months,
      specialized_asset, residual_value_guarantee, rvg_probable_amount,
      auto_classified, rou_asset, lease_liability, status,
      is_complete
    ) VALUES (
      v_caller_org_id, v_user_id, v_company_id, v_branch_id, v_fixed_asset_type_id,
      p_lease->>'lease_name',
      COALESCE(p_lease->>'lease_description', ''),
      p_lease->>'lessor_name',
      p_lease->>'lessor_type',
      (p_lease->>'lease_start_date')::date,
      (p_lease->>'lease_end_date')::date,
      (p_lease->>'lease_term_months')::int,
      (p_lease->>'payment_amount')::numeric,
      p_lease->>'payment_frequency',
      (p_lease->>'incremental_borrowing_rate')::numeric,
      NULLIF(p_lease->>'implicit_rate', '')::numeric,
      COALESCE((p_lease->>'implicit_rate_readily_determinable')::boolean, false),
      NULLIF(p_lease->>'risk_free_rate', '')::numeric,
      NULLIF(p_lease->>'risk_free_rate_source', ''),
      NULLIF(p_lease->>'risk_free_rate_date', '')::date,
      p_lease->>'discount_rate_method',
      NULLIF(p_lease->>'discount_rate', '')::numeric,
      NULLIF(p_lease->>'rate_source', ''),
      NULLIF(p_lease->>'rate_date', '')::date,
      v_risk_free_policy_election_id,
      p_lease->>'accounting_treatment',
      v_short_term_policy_election_id,
      COALESCE(NULLIF(p_lease->>'lease_component_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'nonlease_component_amount', '')::numeric, 0),
      p_lease->>'component_policy',
      v_component_policy_election_id,
      COALESCE((p_lease->>'related_party')::boolean, false),
      NULLIF(p_lease->>'related_party_name', ''),
      COALESCE((p_lease->>'purchase_option_reasonably_certain')::boolean, false),
      COALESCE(NULLIF(p_lease->>'renewal_months_reasonably_certain', '')::int, 0),
      NULLIF(p_lease->>'renewal_payment_amount', '')::numeric,
      NULLIF(p_lease->>'termination_option_month', '')::int,
      COALESCE((p_lease->>'termination_option_reasonably_certain')::boolean, false),
      COALESCE(NULLIF(p_lease->>'termination_penalty_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'prepaid_lease_payments', '')::numeric, 0),
      p_lease->>'lease_classification',
      COALESCE(NULLIF(p_lease->>'initial_direct_costs', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'lease_incentives', '')::numeric, 0),
      p_lease->>'payment_timing',
      NULLIF(p_lease->>'payment_day_of_month', '')::int,
      COALESCE((p_lease->>'transfer_ownership')::boolean, false),
      COALESCE((p_lease->>'purchase_option')::boolean, false),
      COALESCE(NULLIF(p_lease->>'purchase_option_price', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'asset_fair_value', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'asset_market_value', '')::numeric, 0),
      v_life_months,
      COALESCE((p_lease->>'specialized_asset')::boolean, false),
      COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
      COALESCE((p_lease->>'auto_classified')::boolean, false),
      COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
      COALESCE(p_lease->>'status', 'active'),
      false
    )
    RETURNING id INTO v_lease_id;
  END IF;

  IF v_posted_through IS NULL THEN
    DELETE FROM lease_payment_schedules WHERE lease_id = v_lease_id;
    v_idx := 0;
    WHILE v_idx < jsonb_array_length(p_payment_schedule) LOOP
      v_pay_row := p_payment_schedule->v_idx;
      INSERT INTO lease_payment_schedules (lease_id, from_month, to_month, payment_amount, organization_id)
      VALUES (v_lease_id, (v_pay_row->>'from_month')::int, (v_pay_row->>'to_month')::int,
              (v_pay_row->>'payment_amount')::numeric, v_caller_org_id);
      v_idx := v_idx + 1;
    END LOOP;

    DELETE FROM amortization_schedules WHERE lease_id = v_lease_id;
    v_idx := 0;
    WHILE v_idx < jsonb_array_length(p_amortization) LOOP
      v_amort_row := p_amortization->v_idx;
      INSERT INTO amortization_schedules (
        lease_id, period_number, period_date,
        beginning_liability, payment_amount, interest_expense,
        principal_reduction, ending_liability, rou_asset_balance,
        depreciation_expense, short_term_lease_cost, organization_id
      ) VALUES (
        v_lease_id,
        (v_amort_row->>'period_number')::int,
        (v_amort_row->>'period_date')::date,
        COALESCE((v_amort_row->>'beginning_liability')::numeric, 0),
        COALESCE((v_amort_row->>'payment_amount')::numeric, 0),
        COALESCE((v_amort_row->>'interest_expense')::numeric, 0),
        COALESCE((v_amort_row->>'principal_reduction')::numeric, 0),
        COALESCE((v_amort_row->>'ending_liability')::numeric, 0),
        COALESCE((v_amort_row->>'rou_asset_balance')::numeric, 0),
        COALESCE((v_amort_row->>'depreciation_expense')::numeric, 0),
        COALESCE((v_amort_row->>'short_term_lease_cost')::numeric, 0),
        v_caller_org_id
      );
      v_idx := v_idx + 1;
    END LOOP;

    IF jsonb_array_length(p_recognition) > 0 THEN
      IF v_is_edit THEN
        DELETE FROM lease_transactions
        WHERE lease_id = v_lease_id AND transaction_type = 'initial_recognition';
      END IF;
      v_idx := 0;
      WHILE v_idx < jsonb_array_length(p_recognition) LOOP
        v_recog_row := p_recognition->v_idx;
        INSERT INTO lease_transactions (
          lease_id, transaction_date, transaction_type,
          description, account_debited, account_credited,
          amount, user_id, organization_id
        ) VALUES (
          v_lease_id,
          (v_recog_row->>'transaction_date')::date,
          'initial_recognition',
          v_recog_row->>'description',
          v_recog_row->>'account_debited',
          v_recog_row->>'account_credited',
          (v_recog_row->>'amount')::numeric,
          v_user_id,
          v_caller_org_id
        );
        v_idx := v_idx + 1;
      END LOOP;
    END IF;
  END IF;

  UPDATE leases SET is_complete = true, updated_at = now() WHERE id = v_lease_id;

  RETURN v_lease_id;
END;
$function$;

/*
# Fix save_lease: org isolation for all referenced IDs + safe parameterized insert/update

## Security gaps fixed
1. company_id, branch_id, fixed_asset_type_id in p_lease were not validated to belong
   to the caller's org — a user could pass an ID from another org.
2. The dynamic SQL was built by string-concatenating values from the JSONB payload,
   creating a SQL injection surface. Replaced with a parameterized INSERT/UPDATE using
   typed columns, eliminating the dynamic SQL entirely.
3. On edits: the function re-fetched org_id from the lease (correct), but also overwrote
   v_org_id with internal.current_org_id() before validating — swapped order.

## What changed
- INSERT and UPDATE are now typed column-by-column (not dynamic SQL)
- company_id, branch_id, fixed_asset_type_id cross-org checks added
- For edits: org isolation check runs before any data is written
*/

CREATE OR REPLACE FUNCTION public.save_lease(
  p_lease jsonb,
  p_payment_schedule jsonb DEFAULT '[]'::jsonb,
  p_amortization jsonb DEFAULT '[]'::jsonb,
  p_recognition jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lease_id uuid;
  v_is_edit boolean;
  v_caller_org_id uuid;
  v_lease_org_id uuid;
  v_user_id uuid;
  v_recognition_date date;
  v_period_status text;
  v_idx int;
  v_pay_row jsonb;
  v_amort_row jsonb;
  v_recog_row jsonb;
  -- Typed columns for INSERT/UPDATE
  v_company_id uuid;
  v_branch_id uuid;
  v_fixed_asset_type_id uuid;
  v_short_term_policy_election_id uuid;
  v_risk_free_policy_election_id uuid;
  v_component_policy_election_id uuid;
BEGIN
  -- ── 1. Authentication & permission checks ─────────────────────────
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

  IF NOT (
    internal.org_has_active_subscription() OR internal.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Your subscription is not active. Please subscribe to continue.';
  END IF;

  -- ── 2. Determine insert vs update ─────────────────────────────────
  v_lease_id := (p_lease->>'id')::uuid;
  v_is_edit := v_lease_id IS NOT NULL;

  -- ── 3. Org isolation for all referenced IDs ────────────────────────
  -- Parse the nullable foreign key IDs once
  v_company_id := NULLIF(p_lease->>'company_id', '')::uuid;
  v_branch_id := NULLIF(p_lease->>'branch_id', '')::uuid;
  v_fixed_asset_type_id := NULLIF(p_lease->>'fixed_asset_type_id', '')::uuid;
  v_short_term_policy_election_id := NULLIF(p_lease->>'short_term_policy_election_id', '')::uuid;
  v_risk_free_policy_election_id := NULLIF(p_lease->>'risk_free_policy_election_id', '')::uuid;
  v_component_policy_election_id := NULLIF(p_lease->>'component_policy_election_id', '')::uuid;

  -- company_id must belong to the caller's org
  IF v_company_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM companies WHERE id = v_company_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid company: does not belong to your organization';
    END IF;
  END IF;

  -- branch_id must belong to the caller's org
  IF v_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM branches WHERE id = v_branch_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid branch: does not belong to your organization';
    END IF;
  END IF;

  -- fixed_asset_type_id must belong to the caller's org
  IF v_fixed_asset_type_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fixed_asset_types WHERE id = v_fixed_asset_type_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid asset type: does not belong to your organization';
    END IF;
  END IF;

  -- policy election IDs must belong to the caller's org
  IF v_short_term_policy_election_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounting_policy_elections WHERE id = v_short_term_policy_election_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
    END IF;
  END IF;
  IF v_risk_free_policy_election_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounting_policy_elections WHERE id = v_risk_free_policy_election_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
    END IF;
  END IF;
  IF v_component_policy_election_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounting_policy_elections WHERE id = v_component_policy_election_id AND organization_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid policy election: does not belong to your organization';
    END IF;
  END IF;

  -- ── 4. For edits: verify org isolation and check period locking ────
  IF v_is_edit THEN
    SELECT organization_id INTO v_lease_org_id FROM leases WHERE id = v_lease_id;
    IF v_lease_org_id IS NULL OR v_lease_org_id != v_caller_org_id THEN
      RAISE EXCEPTION 'Lease not found in your organization';
    END IF;

    -- Check if the initial recognition period is locked/closed
    SELECT lt.transaction_date INTO v_recognition_date
    FROM lease_transactions lt
    WHERE lt.lease_id = v_lease_id
      AND lt.transaction_type = 'initial_recognition'
    ORDER BY lt.transaction_date ASC
    LIMIT 1;

    IF v_recognition_date IS NOT NULL THEN
      SELECT ap.status INTO v_period_status
      FROM accounting_periods ap
      WHERE ap.organization_id = v_caller_org_id
        AND v_recognition_date >= ap.period_start
        AND v_recognition_date <= ap.period_end
        AND ap.status IN ('locked', 'closed')
      LIMIT 1;

      IF v_period_status IS NOT NULL THEN
        RAISE EXCEPTION 'This lease has posted entries. Use Contract Modification to change it.';
      END IF;
    END IF;
  END IF;

  -- ── 5. Insert or update the lease row (typed columns, no dynamic SQL) ─
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
      risk_free_rate_date           = NULLIF(p_lease->>'risk_free_rate_date', ''),
      discount_rate_method          = p_lease->>'discount_rate_method',
      discount_rate                 = NULLIF(p_lease->>'discount_rate', '')::numeric,
      rate_source                   = NULLIF(p_lease->>'rate_source', ''),
      rate_date                     = NULLIF(p_lease->>'rate_date', ''),
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
      asset_economic_life_years     = COALESCE(NULLIF(p_lease->>'asset_economic_life_years', '')::numeric, 0),
      specialized_asset             = COALESCE((p_lease->>'specialized_asset')::boolean, false),
      residual_value_guarantee      = COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
      rvg_probable_amount           = COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
      auto_classified               = COALESCE((p_lease->>'auto_classified')::boolean, false),
      rou_asset                     = COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
      lease_liability               = COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
      status                        = COALESCE(p_lease->>'status', 'active'),
      updated_at                    = now()
    WHERE id = v_lease_id;
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
      asset_fair_value, asset_market_value, asset_economic_life_years,
      specialized_asset, residual_value_guarantee, rvg_probable_amount,
      auto_classified, rou_asset, lease_liability, status,
      is_complete
    ) VALUES (
      v_caller_org_id,
      v_user_id,
      v_company_id,
      v_branch_id,
      v_fixed_asset_type_id,
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
      NULLIF(p_lease->>'risk_free_rate_date', ''),
      p_lease->>'discount_rate_method',
      NULLIF(p_lease->>'discount_rate', '')::numeric,
      NULLIF(p_lease->>'rate_source', ''),
      NULLIF(p_lease->>'rate_date', ''),
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
      COALESCE(NULLIF(p_lease->>'asset_economic_life_years', '')::numeric, 0),
      COALESCE((p_lease->>'specialized_asset')::boolean, false),
      COALESCE(NULLIF(p_lease->>'residual_value_guarantee', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'rvg_probable_amount', '')::numeric, 0),
      COALESCE((p_lease->>'auto_classified')::boolean, false),
      COALESCE(NULLIF(p_lease->>'rou_asset', '')::numeric, 0),
      COALESCE(NULLIF(p_lease->>'lease_liability', '')::numeric, 0),
      COALESCE(p_lease->>'status', 'active'),
      false -- will be set to true at end of function
    )
    RETURNING id INTO v_lease_id;
  END IF;

  -- ── 6. Replace payment schedule rows ──────────────────────────────
  DELETE FROM lease_payment_schedules WHERE lease_id = v_lease_id;
  IF jsonb_array_length(p_payment_schedule) > 0 THEN
    v_idx := 0;
    WHILE v_idx < jsonb_array_length(p_payment_schedule) LOOP
      v_pay_row := p_payment_schedule->v_idx;
      INSERT INTO lease_payment_schedules (
        lease_id, from_month, to_month, payment_amount, organization_id
      ) VALUES (
        v_lease_id,
        (v_pay_row->>'from_month')::int,
        (v_pay_row->>'to_month')::int,
        (v_pay_row->>'payment_amount')::numeric,
        v_caller_org_id
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- ── 7. Replace amortization schedule rows ─────────────────────────
  DELETE FROM amortization_schedules WHERE lease_id = v_lease_id;
  IF jsonb_array_length(p_amortization) > 0 THEN
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
  END IF;

  -- ── 8. Handle initial recognition transactions ────────────────────
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

  -- ── 9. Mark lease as complete ──────────────────────────────────────
  UPDATE leases SET is_complete = true, updated_at = now() WHERE id = v_lease_id;

  RETURN v_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) TO authenticated;

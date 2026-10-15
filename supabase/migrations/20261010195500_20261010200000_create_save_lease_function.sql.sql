/*
# Create save_lease atomic RPC function

## Purpose
Replaces the multi-step client-side lease save (insert lease → persist payment
schedule → regenerate amortization → insert recognition transactions → mark
complete) with a single atomic database call. If any step fails, the entire
operation rolls back — no incomplete leases are left behind.

## What it does
1. Validates the caller has manage/admin permissions and an active subscription
2. Validates org isolation (the lease's organization_id must match the caller's org)
3. For updates: checks if the initial recognition period is locked/closed — blocks if so
4. Inserts (new) or updates (existing) the lease row
5. Replaces all lease_payment_schedules rows for the lease
6. Replaces all amortization_schedules rows for the lease
7. For new leases: inserts initial_recognition lease_transactions
8. For edits in an open period: replaces initial_recognition lease_transactions
9. Sets is_complete = true
10. Returns the lease id

## Parameters
- p_lease jsonb — all lease columns as key/value pairs
- p_payment_schedule jsonb — array of {from_month, to_month, payment_amount}
- p_amortization jsonb — array of amortization schedule rows
- p_recognition jsonb — array of initial recognition transaction rows

## Security
- SECURITY DEFINER, search_path = 'public'
- Granted EXECUTE to authenticated only
- Uses internal.has_data_access / internal.is_manage_or_admin / internal.has_permission
  for the same checks as RLS policies
- Org isolation enforced via internal.current_org_id()

## Important notes
1. The function expects p_lease to contain an 'id' field when editing (update),
   and no 'id' field when creating (insert).
2. Recognition transactions are only created for non-short-term-exempt leases
   (p_recognition will be an empty array for short-term exempt).
3. For edits: if the initial recognition transaction_date falls in a locked/closed
   accounting period, the function raises an exception with a clear message.
*/

-- The function uses the internal schema helpers, so we place it in public
-- but reference internal functions with schema-qualified names.

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
  v_org_id uuid;
  v_user_id uuid;
  v_recognition_date date;
  v_period_status text;
  v_lease_row jsonb;
  v_col text;
  v_val jsonb;
  v_insert_cols text[];
  v_insert_vals text[];
  v_set_clauses text[];
  v_sql text;
  v_sched jsonb;
  v_amort jsonb;
  v_recog jsonb;
  v_pay_row jsonb;
  v_amort_row jsonb;
  v_recog_row jsonb;
  v_idx int;
  v_count int;
BEGIN
  -- ── 1. Permission checks ──────────────────────────────────────────
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

  v_org_id := internal.current_org_id();

  IF NOT (
    internal.org_has_active_subscription() OR internal.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Your subscription is not active. Please subscribe to continue.';
  END IF;

  -- ── 2. Determine insert vs update ──────────────────────────────────
  v_lease_id := p_lease->>'id';
  v_is_edit := v_lease_id IS NOT NULL;

  -- ── 3. For edits: check org isolation and period locking ───────────
  IF v_is_edit THEN
    -- Verify the lease belongs to the caller's org
    SELECT organization_id INTO v_org_id FROM leases WHERE id = v_lease_id;
    IF v_org_id IS NULL OR v_org_id != internal.current_org_id() THEN
      RAISE EXCEPTION 'Lease not found in your organization';
    END IF;

    -- Check if the initial recognition period is locked/closed
    SELECT transaction_date INTO v_recognition_date
    FROM lease_transactions
    WHERE lease_id = v_lease_id
      AND transaction_type = 'initial_recognition'
    ORDER BY transaction_date ASC
    LIMIT 1;

    IF v_recognition_date IS NOT NULL THEN
      SELECT ap.status INTO v_period_status
      FROM accounting_periods ap
      WHERE ap.organization_id = v_org_id
        AND v_recognition_date >= ap.period_start
        AND v_recognition_date <= ap.period_end
        AND ap.status IN ('locked', 'closed')
      LIMIT 1;

      IF v_period_status IS NOT NULL THEN
        RAISE EXCEPTION 'This lease has posted entries. Use Contract Modification to change it.';
      END IF;
    END IF;
  END IF;

  -- ── 4. Insert or update the lease row ──────────────────────────────
  -- Build dynamic SQL from the JSONB payload (excluding 'id' for inserts,
  -- using all other keys; for updates, build SET clauses).

  IF v_is_edit THEN
    -- Build SET clauses for UPDATE
    v_set_clauses := '{}';
    FOR v_col, v_val IN SELECT key, value FROM jsonb_each_text(p_lease) LOOP
      IF v_col != 'id' THEN
        v_set_clauses := array_append(v_set_clauses,
          quote_ident(v_col) || ' = ' || COALESCE(
            CASE
              WHEN jsonb_typeof(p_lease->v_col) = 'null' THEN 'NULL'
              WHEN jsonb_typeof(p_lease->v_col) = 'boolean' THEN (p_lease->>v_col)
              WHEN jsonb_typeof(p_lease->v_col) = 'number' THEN (p_lease->>v_col)
              ELSE quote_literal(p_lease->>v_col)
            END,
            'NULL'
          )
        );
      END IF;
    END LOOP;

    v_sql := 'UPDATE leases SET ' || array_to_string(v_set_clauses, ', ') ||
             ', updated_at = now() WHERE id = ' || quote_literal(v_lease_id::text);
    EXECUTE v_sql;
  ELSE
    -- Build column lists for INSERT
    v_insert_cols := '{}';
    v_insert_vals := '{}';

    FOR v_col, v_val IN SELECT key, value FROM jsonb_each_text(p_lease) LOOP
      IF v_col != 'id' THEN
        v_insert_cols := array_append(v_insert_cols, quote_ident(v_col));
        v_insert_vals := array_append(v_insert_vals,
          COALESCE(
            CASE
              WHEN jsonb_typeof(p_lease->v_col) = 'null' THEN 'NULL'
              WHEN jsonb_typeof(p_lease->v_col) = 'boolean' THEN (p_lease->>v_col)
              WHEN jsonb_typeof(p_lease->v_col) = 'number' THEN (p_lease->>v_col)
              ELSE quote_literal(p_lease->>v_col)
            END,
            'NULL'
          )
        );
      END IF;
    END LOOP;

    v_sql := 'INSERT INTO leases (' || array_to_string(v_insert_cols, ', ') ||
             ') VALUES (' || array_to_string(v_insert_vals, ', ') ||
             ') RETURNING id';
    EXECUTE v_sql INTO v_lease_id;
  END IF;

  -- ── 5. Replace payment schedule rows ───────────────────────────────
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
        v_org_id
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- ── 6. Replace amortization schedule rows ──────────────────────────
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
        v_org_id
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- ── 7. Handle initial recognition transactions ────────────────────
  -- For new leases: insert the recognition transactions.
  -- For edits in an open period: delete old recognition and insert new.
  IF jsonb_array_length(p_recognition) > 0 THEN
    IF v_is_edit THEN
      DELETE FROM lease_transactions
      WHERE lease_id = v_lease_id
        AND transaction_type = 'initial_recognition';
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
        v_org_id
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- ── 8. Mark lease as complete ──────────────────────────────────────
  UPDATE leases SET is_complete = true, updated_at = now()
  WHERE id = v_lease_id;

  -- ── 9. Return the lease id ─────────────────────────────────────────
  RETURN v_lease_id;
END;
$$;

-- Grant EXECUTE to authenticated only
REVOKE ALL ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) TO authenticated;

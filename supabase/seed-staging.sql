-- Staging demo data. NEVER load this into production and never add real customer data here.
-- Creates one demo sign-in (demo@example.com / StagingDemo-2026!), its organization (created by the
-- normal sign-up trigger), a demo company and 8 leases: 5 operating, 3 finance.
-- Safe to re-run: does nothing if the demo user already exists.

DO $$
DECLARE
  v_user uuid := 'de300000-0000-4000-8000-000000000001';
  v_company uuid := 'de300000-0000-4000-8000-000000000002';
  v_org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user OR email = 'demo@example.com') THEN
    RAISE NOTICE 'Staging demo data already present; skipping.';
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', 'demo@example.com',
    extensions.crypt('StagingDemo-2026!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"company_name":"Northwind Demo Holdings"}', now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    v_user, v_user::text, v_user,
    jsonb_build_object('sub', v_user::text, 'email', 'demo@example.com', 'email_verified', true),
    'email', now(), now(), now()
  );

  SELECT organization_id INTO v_org FROM public.user_profiles WHERE user_id = v_user;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Sign-up trigger did not create an organization for the demo user';
  END IF;

  UPDATE public.subscriptions
     SET plan_key = 'professional', status = 'active', trial_ends_at = NULL,
         current_period_start = now(), current_period_end = now() + interval '1 year'
   WHERE organization_id = v_org;

  INSERT INTO public.companies (id, user_id, organization_id, company_name, company_code, address, city, state, country, postal_code, industry, entity_type)
  VALUES (v_company, v_user, v_org, 'Northwind Demo Holdings', 'NWD', '100 Demo Way', 'Portland', 'OR', 'United States', '97201', 'Retail', 'non_public_business_entity');

  WITH specs (name, descr, lessor, lessor_type, start_date, term, payment, rate, cls, timing, freq, idc, incentives, life) AS (
    VALUES
      ('Downtown HQ Office',       'Floors 4-5, 18,000 sq ft office space',   'Pearl District Properties LLC', 'corporate',             date '2024-01-01', 84, 32500.00, 6.25, 'operating', 'beginning', 'monthly',   12000, 25000, 0),
      ('Eastside Retail Store',    'Street-level retail unit, 4,200 sq ft',  'Hawthorne Commercial REIT',     'corporate',             date '2024-07-01', 60,  9800.00, 6.50, 'operating', 'beginning', 'monthly',    4500,  6000, 0),
      ('Regional Distribution Ctr','Warehouse with 6 dock doors, 65,000 sq ft','Columbia Logistics Parks',     'corporate',             date '2025-01-01', 120, 41000.00, 6.75, 'operating', 'beginning', 'monthly',   18000,     0, 0),
      ('Copier & Print Fleet',     '14 multifunction printers, service separate','OfficeTech Leasing',      'financial_institution', date '2025-04-01', 36,  1850.00, 7.00, 'operating', 'end',       'monthly',       0,     0, 0),
      ('Satellite Sales Office',   'Shared-floor office, Boise',              'Treasure Valley Offices',       'individual',            date '2025-09-01', 36,  4200.00, 6.00, 'operating', 'beginning', 'monthly',       0,  1500, 0),
      ('Delivery Van Fleet',       '12 cargo vans, title transfers at end',   'Pacific Fleet Finance',         'financial_institution', date '2024-03-01', 60, 14400.00, 7.25, 'finance',   'end',       'monthly',    2500,     0, 72),
      ('Warehouse Forklifts',      '8 electric forklifts with bargain purchase option','Cascade Equipment Capital','financial_institution', date '2024-10-01', 48, 15600.00, 7.50, 'finance', 'end',       'quarterly',     0,     0, 60),
      ('POS & Server Hardware',    'Store POS terminals and on-site servers', 'Summit Technology Finance',     'corporate',             date '2025-02-01', 36,  6200.00, 7.75, 'finance',   'beginning', 'monthly',       0,     0, 40)
  ),
  calc AS (
    SELECT s.*,
      CASE s.freq WHEN 'quarterly' THEN 3 ELSE 1 END AS months_per,
      (SELECT sum(s.payment / power(1 + s.rate / 100 * (CASE s.freq WHEN 'quarterly' THEN 3 ELSE 1 END) / 12.0,
                                    k + CASE s.timing WHEN 'end' THEN 1 ELSE 0 END))
         FROM generate_series(0, s.term / (CASE s.freq WHEN 'quarterly' THEN 3 ELSE 1 END) - 1) AS k) AS liability
    FROM specs s
  )
  INSERT INTO public.leases (
    user_id, organization_id, company_id, lease_name, lease_description, lessor_name, lessor_type,
    lease_start_date, lease_end_date, lease_term_months, payment_amount, payment_frequency, payment_timing,
    incremental_borrowing_rate, discount_rate, discount_rate_method, lease_classification,
    initial_direct_costs, lease_incentives, lease_liability, rou_asset,
    asset_fair_value, asset_market_value, asset_economic_life_months,
    transfer_ownership, purchase_option, purchase_option_price, purchase_option_reasonably_certain,
    status, accounting_treatment, is_complete
  )
  SELECT
    v_user, v_org, v_company, name, descr, lessor, lessor_type,
    start_date, (start_date + make_interval(months => term))::date - 1, term, payment, freq, timing,
    rate, rate, 'ibr', cls,
    idc, incentives, round(liability, 2), round(liability + idc - incentives, 2),
    CASE cls WHEN 'finance' THEN round(liability * 1.05, 2) ELSE 0 END,
    CASE cls WHEN 'finance' THEN round(liability * 1.05, 2) ELSE 0 END,
    life,
    name = 'Delivery Van Fleet', name = 'Warehouse Forklifts',
    CASE WHEN name = 'Warehouse Forklifts' THEN 5000 ELSE 0 END, name = 'Warehouse Forklifts',
    'active', 'recognized', true
  FROM calc;
END $$;

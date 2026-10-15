/*
  # Add Lease Classification Fields

  1. Changes
    - Add payment_timing column to store whether payments are made at beginning (annuity due) or end (ordinary annuity) of period
    - Add classification questionnaire fields to help determine if lease should be operating or finance
    - Add asset_fair_value for purchase option comparison
    - Add residual_value_guarantee for liability calculations
    
  2. Classification Tests (ASC 842)
    - Transfer of ownership test
    - Purchase option test (compare bargain price to fair value)
    - Lease term test (major part of economic life - typically 75%)
    - Present value test (substantially all fair value - typically 90%)
    - Specialized asset test
*/

-- Add payment timing field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'payment_timing'
  ) THEN
    ALTER TABLE leases ADD COLUMN payment_timing text DEFAULT 'beginning' CHECK (payment_timing IN ('beginning', 'end'));
  END IF;
END $$;

-- Add classification questionnaire fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'transfer_ownership'
  ) THEN
    ALTER TABLE leases ADD COLUMN transfer_ownership boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'purchase_option'
  ) THEN
    ALTER TABLE leases ADD COLUMN purchase_option boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'purchase_option_price'
  ) THEN
    ALTER TABLE leases ADD COLUMN purchase_option_price numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'asset_fair_value'
  ) THEN
    ALTER TABLE leases ADD COLUMN asset_fair_value numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'asset_economic_life_years'
  ) THEN
    ALTER TABLE leases ADD COLUMN asset_economic_life_years numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'specialized_asset'
  ) THEN
    ALTER TABLE leases ADD COLUMN specialized_asset boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'residual_value_guarantee'
  ) THEN
    ALTER TABLE leases ADD COLUMN residual_value_guarantee numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'auto_classified'
  ) THEN
    ALTER TABLE leases ADD COLUMN auto_classified boolean DEFAULT false;
  END IF;
END $$;

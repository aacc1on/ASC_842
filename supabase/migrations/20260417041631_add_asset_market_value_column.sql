/*
  # Add asset_market_value column to leases

  ## Summary
  Adds a new `asset_market_value` column to the `leases` table to store the
  independent market (fair) value of the underlying asset, separate from the
  lease fair value used in ASC 842 classification tests.

  ## Changes
  - `leases` table: new `asset_market_value` numeric column, defaults to 0
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leases' AND column_name = 'asset_market_value'
  ) THEN
    ALTER TABLE leases ADD COLUMN asset_market_value numeric(15,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

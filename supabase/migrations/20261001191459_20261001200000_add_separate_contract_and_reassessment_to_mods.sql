DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_modifications' AND column_name = 'separate_contract'
  ) THEN
    ALTER TABLE contract_modifications ADD COLUMN separate_contract boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_modifications' AND column_name = 'fair_value_at_modification'
  ) THEN
    ALTER TABLE contract_modifications ADD COLUMN fair_value_at_modification numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_modifications' AND column_name = 'remaining_economic_life_months'
  ) THEN
    ALTER TABLE contract_modifications ADD COLUMN remaining_economic_life_months int DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_modifications' AND column_name = 'reassessed_classification'
  ) THEN
    ALTER TABLE contract_modifications ADD COLUMN reassessed_classification text DEFAULT NULL;
  END IF;
END $$;

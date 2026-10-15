/*
  # Add NOT NULL constraints and CHECK constraints for data integrity

  1. Modified Tables
    - `transactions`
      - `account_debited`: Add NOT NULL constraint (has DEFAULT '')
      - `account_credited`: Add NOT NULL constraint (has DEFAULT '')
    - `contract_modifications`
      - `accounting_treatment`: Add NOT NULL constraint (has DEFAULT '')
    - `documents`
      - `file_size`: Add CHECK constraint to prevent negative values

  2. Important Notes
    - Uses DO blocks with conditional logic to avoid failures on re-run
    - Only applies constraints if columns exist and no constraint already exists
    - Non-destructive: existing data with empty strings remains valid
*/

DO $$
BEGIN
  -- transactions.account_debited NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'account_debited'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN account_debited SET NOT NULL;
  END IF;

  -- transactions.account_credited NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'account_credited'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN account_credited SET NOT NULL;
  END IF;

  -- contract_modifications.accounting_treatment NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contract_modifications' AND column_name = 'accounting_treatment'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE contract_modifications ALTER COLUMN accounting_treatment SET NOT NULL;
  END IF;
END $$;

-- documents.file_size CHECK >= 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'documents_file_size_non_negative'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_file_size_non_negative CHECK (file_size >= 0);
  END IF;
END $$;

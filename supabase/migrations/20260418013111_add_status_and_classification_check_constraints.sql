/*
  # Add CHECK Constraints on Status and Classification Columns

  1. Purpose
    - Enforce valid enum-like values at the database layer for status, type, and
      classification columns so invalid values cannot be written even if the
      application layer misbehaves.

  2. Constraints Added (each guarded by an IF NOT EXISTS check)
    - leases.status: active, terminated, expired, cancelled, pending
    - leases.lease_classification: operating, finance
    - leases.lessor_type: corporate, individual, government, financial_institution, other
    - leases.payment_timing: beginning, end
    - leases.payment_frequency: monthly, quarterly, annually, semi_annually, weekly
    - contract_modifications.status: draft, pending_approval, approved, rejected, cancelled
    - contract_modifications.modification_type: payment_change, term_extension, term_reduction, rate_change, scope_change, other
    - contract_modifications.accounting_treatment: remeasurement, separate_lease, partial_termination, other
    - contract_cancellations.status: pending_approval, approved, rejected, cancelled
    - lease_transactions.transaction_type: initial_recognition, modification, remeasurement, termination
    - transactions.transaction_type: payment, interest, amortization, initial_recognition,
      lease_modification, lease_cancellation, impairment, derecognition, reversal
    - month_end_documents.status: draft, pending, finalized, closed
    - accounting_periods.status: open, closed, locked

  3. Safety Notes
    1. Each constraint is wrapped in a DO block that checks pg_constraint to avoid
       errors if a constraint with the same name already exists.
    2. NOT VALID is NOT used; the constraint is validated against existing rows. If
       data violates the constraint, the migration will fail safely without
       altering or deleting any data.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_status_check') THEN
    ALTER TABLE leases ADD CONSTRAINT leases_status_check
      CHECK (status IN ('active','terminated','expired','cancelled','pending'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_lease_classification_check') THEN
    ALTER TABLE leases ADD CONSTRAINT leases_lease_classification_check
      CHECK (lease_classification IN ('operating','finance'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_lessor_type_check') THEN
    ALTER TABLE leases ADD CONSTRAINT leases_lessor_type_check
      CHECK (lessor_type IN ('corporate','individual','government','financial_institution','other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_payment_timing_check') THEN
    ALTER TABLE leases ADD CONSTRAINT leases_payment_timing_check
      CHECK (payment_timing IN ('beginning','end'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_payment_frequency_check') THEN
    ALTER TABLE leases ADD CONSTRAINT leases_payment_frequency_check
      CHECK (payment_frequency IN ('monthly','quarterly','semi_annually','annually','weekly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_modifications_status_check') THEN
    ALTER TABLE contract_modifications ADD CONSTRAINT contract_modifications_status_check
      CHECK (status IN ('draft','pending_approval','approved','rejected','cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_modifications_modification_type_check') THEN
    ALTER TABLE contract_modifications ADD CONSTRAINT contract_modifications_modification_type_check
      CHECK (modification_type IN ('payment_change','term_extension','term_reduction','rate_change','scope_change','other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_modifications_accounting_treatment_check') THEN
    ALTER TABLE contract_modifications ADD CONSTRAINT contract_modifications_accounting_treatment_check
      CHECK (accounting_treatment IN ('remeasurement','separate_lease','partial_termination','other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_cancellations_status_check') THEN
    ALTER TABLE contract_cancellations ADD CONSTRAINT contract_cancellations_status_check
      CHECK (status IN ('pending_approval','approved','rejected','cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lease_transactions_transaction_type_check') THEN
    ALTER TABLE lease_transactions ADD CONSTRAINT lease_transactions_transaction_type_check
      CHECK (transaction_type IN ('initial_recognition','modification','remeasurement','termination'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_transaction_type_check') THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check
      CHECK (transaction_type IN ('payment','interest','amortization','initial_recognition','lease_modification','lease_cancellation','impairment','derecognition','reversal'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'month_end_documents_status_check') THEN
    ALTER TABLE month_end_documents ADD CONSTRAINT month_end_documents_status_check
      CHECK (status IN ('draft','pending','finalized','closed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_periods_status_check') THEN
    ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_status_check
      CHECK (status IN ('open','closed','locked'));
  END IF;
END $$;

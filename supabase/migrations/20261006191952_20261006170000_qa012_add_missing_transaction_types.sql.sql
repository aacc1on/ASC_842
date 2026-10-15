/*
# QA-012: Allow all transaction_type values the code writes

## Problem
The CHECK constraints on `transactions.transaction_type` and
`lease_transactions.transaction_type` are missing values that the
application writes:

- `transactions` is missing: `operating_lease_expense`,
  `short_term_lease_expense`, `nonlease_component_expense`
  (written by monthEndTransactions.ts for operating, short-term and
  nonlease-component expense entries)
- `lease_transactions` is missing: `impairment`
  (written by leaseModification.ts applyImpairment)

This causes inserts to fail with a CHECK constraint violation when
the app posts these transaction types.

## Changes
1. Drop and recreate `transactions_transaction_type_check` to add the
   three missing values.
2. Drop and recreate `lease_transactions_transaction_type_check` to add
   `impairment`.

## Security
No RLS or policy changes — only CHECK constraints are modified.
*/

-- 1. transactions: add operating_lease_expense, short_term_lease_expense, nonlease_component_expense
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;

ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check
CHECK (
  transaction_type = ANY (ARRAY[
    'payment'::text,
    'interest'::text,
    'amortization'::text,
    'initial_recognition'::text,
    'lease_modification'::text,
    'lease_cancellation'::text,
    'impairment'::text,
    'derecognition'::text,
    'reversal'::text,
    'operating_lease_expense'::text,
    'short_term_lease_expense'::text,
    'nonlease_component_expense'::text
  ])
);

-- 2. lease_transactions: add impairment
ALTER TABLE lease_transactions DROP CONSTRAINT IF EXISTS lease_transactions_transaction_type_check;

ALTER TABLE lease_transactions ADD CONSTRAINT lease_transactions_transaction_type_check
CHECK (
  transaction_type = ANY (ARRAY[
    'initial_recognition'::text,
    'modification'::text,
    'remeasurement'::text,
    'termination'::text,
    'impairment'::text
  ])
);

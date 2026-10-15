/*
# Add missing foreign-key indexes

## Performance advisor findings (before):
- subscriptions.subscriptions_plan_key_fkey (plan_key column) — no covering index
- transactions.transactions_month_end_document_id_fkey (month_end_document_id column) — no covering index
- transactions.transactions_reversal_of_fkey (reversal_of column) — no covering index

## Changes:
- Add index on subscriptions(plan_key) to cover the plan_key foreign key
- Add index on transactions(month_end_document_id) to cover the month_end_document_id foreign key
- Add index on transactions(reversal_of) to cover the reversal_of foreign key

## Security: No changes to RLS policies or table structures.
*/

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_key_fkey
  ON public.subscriptions (plan_key);

CREATE INDEX IF NOT EXISTS idx_transactions_month_end_doc_fkey
  ON public.transactions (month_end_document_id);

CREATE INDEX IF NOT EXISTS idx_transactions_reversal_of_fkey
  ON public.transactions (reversal_of);
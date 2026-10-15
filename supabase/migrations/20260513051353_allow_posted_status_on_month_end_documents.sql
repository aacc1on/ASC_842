/*
  # Allow 'posted' status on month_end_documents

  1. Changes
    - Drops the existing `month_end_documents_status_check` constraint
    - Recreates it to also accept `'posted'` in addition to the previously
      allowed values (`draft`, `pending`, `finalized`, `closed`)

  2. Data Safety
    - No rows are modified or deleted
    - Only the CHECK constraint is relaxed (widened), so all existing rows
      remain valid under the new constraint
    - Column default of `'posted'` is preserved

  3. Notes
    - This unblocks Month-End Processing's `Process Transactions` action,
      which inserts new documents with status `'posted'`
*/

ALTER TABLE public.month_end_documents
  DROP CONSTRAINT IF EXISTS month_end_documents_status_check;

ALTER TABLE public.month_end_documents
  ADD CONSTRAINT month_end_documents_status_check
  CHECK (status IN ('draft', 'pending', 'posted', 'finalized', 'closed'));

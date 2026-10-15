/*
# Enforce balanced ledger batches

Every accounting entry must have equal debits and credits. Until now this was only enforced by the
app code; a missing "Prepaid Rent (Cash)" credit let one unbalanced initial recognition entry
(BMW 250 MN-458, 2026-10-01, debits 29,635.99 vs credits 24,635.99) reach `journal_entries`.

1. New function
- `internal.assert_ledger_batch_balanced()`: trigger function that checks one batch.
  - `journal_entries`: batch = lease + entry_date + entry_type; sum(debit_amount) must equal sum(credit_amount) (to the cent).
  - `transactions`: batch = lease + transaction_date + transaction_type; sum(debit_amount) must equal sum(credit_amount).
  - `lease_transactions`: each row carries one amount for both sides, so it must name both a debited and a credited account and have a non-negative amount.

2. New constraint triggers (DEFERRABLE INITIALLY DEFERRED, AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW)
- `ledger_batch_balanced` on `journal_entries`, `transactions`, `lease_transactions`.
  - Deferred to the end of the transaction, so a batch written by one statement or one RPC call
    (e.g. `refresh_lease_journal_entries`, month-end posting) is checked as a whole, not row by row.

3. Notes
1. Existing rows are not rewritten. The check runs only when a batch is written to.
2. Before this migration the only unbalanced batch in any ledger was the BMW initial recognition above
   (Test organization, period not locked). It is corrected separately with the missing credit line.
3. No RLS or grant changes. The function is SECURITY INVOKER-free trigger code with an empty search_path
   and is not executable by anon/authenticated directly.
*/

CREATE OR REPLACE FUNCTION internal.assert_ledger_batch_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  r record;
  v_dr numeric;
  v_cr numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  IF TG_TABLE_NAME = 'journal_entries' THEN
    SELECT COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0) INTO v_dr, v_cr
    FROM public.journal_entries
    WHERE lease_id = r.lease_id AND entry_date = r.entry_date AND entry_type = r.entry_type;
    IF round(v_dr, 2) <> round(v_cr, 2) THEN
      RAISE EXCEPTION 'Journal entry "%" on % does not balance: debits % vs credits %.',
        r.entry_type, r.entry_date, round(v_dr, 2), round(v_cr, 2)
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF TG_TABLE_NAME = 'transactions' THEN
    SELECT COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0) INTO v_dr, v_cr
    FROM public.transactions
    WHERE lease_id IS NOT DISTINCT FROM r.lease_id
      AND transaction_date = r.transaction_date
      AND transaction_type = r.transaction_type;
    IF round(v_dr, 2) <> round(v_cr, 2) THEN
      RAISE EXCEPTION 'Transaction "%" on % does not balance: debits % vs credits %.',
        r.transaction_type, r.transaction_date, round(v_dr, 2), round(v_cr, 2)
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF TG_TABLE_NAME = 'lease_transactions' AND TG_OP <> 'DELETE' THEN
    IF COALESCE(btrim(r.account_debited), '') = '' OR COALESCE(btrim(r.account_credited), '') = ''
       OR COALESCE(r.amount, 0) < 0 THEN
      RAISE EXCEPTION 'Lease event "%" on % must name a debited and a credited account and a non-negative amount.',
        r.transaction_type, r.transaction_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION internal.assert_ledger_batch_balanced() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ledger_batch_balanced ON public.journal_entries;
CREATE CONSTRAINT TRIGGER ledger_batch_balanced
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION internal.assert_ledger_batch_balanced();

DROP TRIGGER IF EXISTS ledger_batch_balanced ON public.transactions;
CREATE CONSTRAINT TRIGGER ledger_batch_balanced
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION internal.assert_ledger_batch_balanced();

DROP TRIGGER IF EXISTS ledger_batch_balanced ON public.lease_transactions;
CREATE CONSTRAINT TRIGGER ledger_batch_balanced
  AFTER INSERT OR UPDATE ON public.lease_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION internal.assert_ledger_batch_balanced();

/*
# Backfill missing initial-recognition transactions

1. Purpose
- Restore the journal entry shown in the Transactions menu for completed,
  recognized leases that were saved without an initial-recognition transaction.

2. Data changes
- Adds one initial-recognition entry per eligible lease that currently has no
  initial-recognition entry.
- Uses the lease's existing liability, start date, name, user, and organization.
- Does not alter or delete leases or existing transactions.

3. Scope
- Only leases with `accounting_treatment = 'recognized'` are included.
- Existing initial-recognition entries are excluded, making this safe to re-run.
- Extra direct-cost, incentive, and prepaid entries are not needed for the
  affected records because none of them contain those amounts.

4. Security
- Rows inherit the lease's existing `user_id` and `organization_id`.
- Existing row-level security policies and tenant isolation remain unchanged.
*/

INSERT INTO public.lease_transactions (
  lease_id,
  transaction_date,
  transaction_type,
  description,
  account_debited,
  account_credited,
  amount,
  user_id,
  organization_id
)
SELECT
  l.id,
  l.lease_start_date,
  'initial_recognition',
  'Initial lease liability recognized for lease: ' || l.lease_name,
  'Right-of-Use Asset',
  'Lease Liability',
  COALESCE(l.lease_liability, 0),
  l.user_id,
  l.organization_id
FROM public.leases l
WHERE l.accounting_treatment = 'recognized'
  AND NOT EXISTS (
    SELECT 1
    FROM public.lease_transactions lt
    WHERE lt.lease_id = l.id
      AND lt.transaction_type = 'initial_recognition'
  );

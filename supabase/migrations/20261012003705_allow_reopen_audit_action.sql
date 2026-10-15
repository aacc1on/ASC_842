/*
# Allow REOPEN in the audit log

1. Modified tables
- `audit_log`: the action check constraint now also accepts 'REOPEN', which
  internal.reopen_month_end writes when an admin reopens the latest month. Previously the insert
  violated the constraint and every reopen failed.

No data changes, no policy changes.
*/

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action = ANY (ARRAY[
  'INSERT','UPDATE','DELETE','BACKFILL','REOPEN','Self-approved','Auto-approved (single-user plan)',
  'Approved','Rejected','Auto-approved (approval workflow off)']));

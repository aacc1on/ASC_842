/*
  # Prevent duplicate lease names per user

  ## Summary
  Adds a case-insensitive uniqueness constraint on lease names within a single
  user's portfolio so that the same lease cannot be created twice. The lease's
  primary key (`id`) is unchanged — uniqueness is enforced via a partial unique
  index on the normalized `lease_name`.

  ## Changes
  1. New unique index `leases_user_lease_name_unique_idx`
     - Enforces uniqueness of (user_id, lower(trim(lease_name)))
     - Created with IF NOT EXISTS so the migration is idempotent
     - Case-insensitive and ignores leading/trailing whitespace, so
       "Building A" and "building a " are treated as the same lease

  ## Security
  - No RLS changes; existing policies on the `leases` table continue to apply
  - Constraint is enforced server-side and cannot be bypassed by the client
*/

CREATE UNIQUE INDEX IF NOT EXISTS leases_user_lease_name_unique_idx
  ON public.leases (user_id, lower(trim(lease_name)));

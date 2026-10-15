/*
  Replace the per-user unique index on lease names with an org+company scoped
  partial unique index.

  The old index (leases_user_lease_name_unique_idx) enforced uniqueness on
  (user_id, lower(trim(lease_name))), which is wrong for a multi-company,
  multi-organisation app: two different companies in the same org cannot have
  leases with the same name, while two users in the same org *can* create
  duplicates because user_id differs.

  The new index enforces uniqueness on
  (organization_id, company_id, lower(trim(lease_name)))
  only for active leases, so cancelled / archived / soft-deleted leases do not
  block re-use of a name.

  No existing rows violate the new constraint (verified before applying).
*/

DROP INDEX IF EXISTS public.leases_user_lease_name_unique_idx;

CREATE UNIQUE INDEX leases_org_company_name_unique_idx
  ON public.leases (organization_id, company_id, lower(trim(lease_name)))
  WHERE status = 'active';
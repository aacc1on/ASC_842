/*
# Remove invalid user ownership triggers from amortization schedules

1. Purpose
- Fix lease saving for all authenticated users by removing triggers that reference
  a `user_id` field that does not exist on `amortization_schedules`.

2. Affected table
- `public.amortization_schedules`
- No columns, rows, or accounting data are changed.

3. Security
- Remove the invalid `set_user_id` BEFORE INSERT trigger from
  `amortization_schedules`.
- Remove the invalid `prevent_user_id_change` BEFORE UPDATE trigger from
  `amortization_schedules`.
- Tenant isolation and existing row-level security policies remain unchanged.

4. Important notes
- Ownership for amortization schedules is enforced through the related lease and
  organization-level policies, not a nonexistent schedule-level `user_id`.
- The migration is idempotent and safe to re-run.
*/

DROP TRIGGER IF EXISTS set_user_id ON public.amortization_schedules;
DROP TRIGGER IF EXISTS prevent_user_id_change ON public.amortization_schedules;

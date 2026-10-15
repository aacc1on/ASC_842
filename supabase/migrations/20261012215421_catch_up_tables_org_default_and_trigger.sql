/*
  # Catch-up tables: organization default and a00 trigger

  1. Changes
    - `month_end_catch_up_batches.organization_id` and `month_end_catch_up_lines.organization_id`
      now default to `internal.current_org_id()`.
    - Both tables get the `a00_set_organization_id` BEFORE INSERT OR UPDATE trigger, matching every
      other organization-scoped table (fills the org first and keeps it immutable).

  2. Notes
    - Rows are only written by the server-side catch-up functions, which always pass the org
      explicitly; this keeps the tables consistent with the project-wide rule.
    - Idempotent: the trigger is dropped if present before being created. No data changes.
*/

ALTER TABLE public.month_end_catch_up_batches ALTER COLUMN organization_id SET DEFAULT internal.current_org_id();
ALTER TABLE public.month_end_catch_up_lines ALTER COLUMN organization_id SET DEFAULT internal.current_org_id();

DROP TRIGGER IF EXISTS a00_set_organization_id ON public.month_end_catch_up_batches;
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.month_end_catch_up_batches
  FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

DROP TRIGGER IF EXISTS a00_set_organization_id ON public.month_end_catch_up_lines;
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.month_end_catch_up_lines
  FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

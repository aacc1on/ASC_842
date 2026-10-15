/*
# legal_acceptances: organization_id default and a00 trigger

1. Modified Tables
  - `legal_acceptances.organization_id` now defaults to `internal.current_org_id()`, matching every
    other organization-scoped table.
  - Adds the `a00_set_organization_id` BEFORE INSERT OR UPDATE trigger, which fills the caller's
    organization when omitted and keeps organization_id immutable.

2. Security
  - No policy changes. Rows are still written only by SECURITY DEFINER functions that set
    organization_id explicitly; the trigger keeps explicit values (COALESCE).

3. Notes
  1. Idempotent: the trigger is dropped and recreated; the default is re-set.
*/

ALTER TABLE public.legal_acceptances ALTER COLUMN organization_id SET DEFAULT internal.current_org_id();

DROP TRIGGER IF EXISTS a00_set_organization_id ON public.legal_acceptances;
CREATE TRIGGER a00_set_organization_id BEFORE INSERT OR UPDATE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

/*
# Prevent duplicate asset classes per organization

1. Changes
- Adds a unique index on `fixed_asset_types` over (`organization_id`, lower(trim(`type_name`))),
  so an organization cannot have two asset classes with the same name (case and surrounding spaces ignored).
2. Security
- No RLS changes.
3. Notes
- Existing data was checked: no duplicates exist, so the index builds cleanly.
- The app shows a friendly "already exists" message when this rule is hit.
*/

CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_types_org_name_unique
  ON public.fixed_asset_types (organization_id, lower(btrim(type_name)));

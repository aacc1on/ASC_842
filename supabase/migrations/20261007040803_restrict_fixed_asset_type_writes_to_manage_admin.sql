/*
# Require manage or admin role for fixed asset type writes

1. Security changes
- `fixed_asset_types` write policies contained no role check at all: any
  signed-in member could insert a row with their own `user_id`, then edit or
  delete it, affecting asset classification shared across the organisation.
- Writes now require the `manage` or `admin` role, matching the role-aware
  SELECT policy.

2. Notes
- Reads are unchanged.
*/

DROP POLICY IF EXISTS "Users can insert own fixed_asset_types" ON public.fixed_asset_types;
CREATE POLICY "Users can insert own fixed_asset_types"
ON public.fixed_asset_types FOR INSERT
TO authenticated
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "Users can update own fixed_asset_types" ON public.fixed_asset_types;
CREATE POLICY "Users can update own fixed_asset_types"
ON public.fixed_asset_types FOR UPDATE
TO authenticated
USING (internal.is_manage_or_admin())
WITH CHECK (internal.is_manage_or_admin());

DROP POLICY IF EXISTS "Users can delete own fixed_asset_types" ON public.fixed_asset_types;
CREATE POLICY "Users can delete own fixed_asset_types"
ON public.fixed_asset_types FOR DELETE
TO authenticated
USING (internal.is_manage_or_admin());

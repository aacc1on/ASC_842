/*
  Fix internal.has_data_access() to include 'view' role.
  The original public.has_data_access() included view role for shared data access,
  but when moved to internal schema, 'view' was accidentally omitted.
*/

CREATE OR REPLACE FUNCTION internal.has_data_access()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage', 'view')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

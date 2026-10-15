/*
  Revert has_data_access() to admin/manage only.
  
  The 'view' role was incorrectly added, which made every authenticated user
  see ALL data across all tables. View users should only see their own data
  via the existing user_id = auth.uid() policies on each table.
*/

CREATE OR REPLACE FUNCTION internal.has_data_access()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manage')
  );
END;
$$;
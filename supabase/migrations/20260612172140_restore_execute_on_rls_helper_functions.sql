-- Restore EXECUTE on the three RLS helper functions for the authenticated role.
-- These functions are called by RLS policies on user_profiles and other tables.
-- When authenticated cannot execute them, the policies throw "permission denied"
-- instead of returning false, causing ALL queries on those tables to fail for every user.
-- The REST API exposure risk is acceptable: these functions only return booleans
-- about the calling user's own role (no data is leaked).

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manage_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_data_access() TO authenticated;

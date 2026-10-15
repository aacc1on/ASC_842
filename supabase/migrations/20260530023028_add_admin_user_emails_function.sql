/*
  # Add admin function to list user emails

  1. New Functions
    - `get_user_emails_for_admin()` - Returns user_id and email pairs for admin users
    - Only callable by authenticated users with admin role

  2. Security
    - Function checks caller is admin before returning data
    - Uses SECURITY DEFINER to access auth.users
    - Returns empty set for non-admin callers
*/

CREATE OR REPLACE FUNCTION get_user_emails_for_admin()
RETURNS TABLE (user_id uuid, email text) AS $$
BEGIN
  IF NOT is_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

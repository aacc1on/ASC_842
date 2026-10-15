-- Free Trial now includes multi_user (same as Enterprise).
-- Paid Starter and Professional stay one user; Enterprise stays multi-user.
-- org_has_feature('multi_user') returns true when plan key is 'trial' or 'enterprise'.

CREATE OR REPLACE FUNCTION internal.org_has_feature(feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = internal, public
AS $$
  SELECT CASE
    WHEN internal.org_plan_key() IN ('enterprise', 'trial') THEN TRUE
    WHEN internal.org_plan_key() IN ('professional') AND feature IN ('contract_modifications', 'branches') THEN TRUE
    WHEN internal.org_plan_key() = 'trial' AND feature IN ('contract_modifications', 'branches') THEN TRUE
    ELSE FALSE
  END
$$;

GRANT EXECUTE ON FUNCTION internal.org_has_feature(text) TO authenticated;

/*
# Secure platform ownership and trial administrator self-approval

1. Purpose
- Separate the single platform owner from ordinary organization administrators.
- Restore subscription gating for ordinary organization administrators.
- Allow a trial organization administrator to self-approve accounting policy elections, including multi-user trial organizations.

2. New table
- `internal.platform_admins` stores the platform-owner user ID and is not writable by client roles.

3. New authorization helpers
- `internal.is_platform_admin()` checks the signed-in user against the allow-list.
- `internal.is_platform_admin_for_user(uuid)` supports trusted server-side checks.
- `public.is_platform_admin()` is a client-safe wrapper for menu and route visibility.

4. Security changes
- All restrictive subscription policies now allow only the platform-owner allow-list as a bypass.
- Ordinary organization admins follow their subscription status.
- Existing tenant isolation and role checks remain in force.

5. Trial approval behavior
- A trial organization administrator may self-approve an accounting policy election even when other organization users exist.
- The existing paid single-user self-approval rule remains unchanged.
- Enterprise organizations with two or more users continue to require a different approver.
- Trial self-approval sets `self_approved = true` and records `Self-approved (trial, admin)` in the audit log.

6. Important notes
- No customer data is deleted or modified.
- Contract modifications, cancellations, impairments, and month-end posting were reviewed and do not currently contain a preparer-versus-approver database check; this migration does not invent one.
*/

CREATE TABLE IF NOT EXISTS internal.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE internal.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.platform_admins FROM anon, authenticated;
-- Guarded so a fresh (staging) database without this production account skips it; same effect on production.
INSERT INTO internal.platform_admins (user_id)
SELECT id FROM auth.users WHERE id = '768308c8-0b63-4f1a-aed1-d7deeb00aa31'::uuid
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION internal.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION internal.is_platform_admin_for_user(target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT EXISTS (SELECT 1 FROM internal.platform_admins WHERE user_id = target_user_id) $$;

REVOKE ALL ON FUNCTION internal.is_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.is_platform_admin_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION internal.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT internal.is_platform_admin() $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin_for_user(target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = internal, public
AS $$ SELECT internal.is_platform_admin_for_user(target_user_id) $$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_for_user(uuid) TO service_role;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%org_has_active_subscription%'
        OR with_check ILIKE '%org_has_active_subscription%')
  LOOP
    IF policy_row.cmd = 'INSERT' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK ((%s) OR (SELECT internal.is_platform_admin()))',
        policy_row.policyname, policy_row.tablename, policy_row.with_check
      );
    ELSIF policy_row.cmd = 'DELETE' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING ((%s) OR (SELECT internal.is_platform_admin()))',
        policy_row.policyname, policy_row.tablename, policy_row.qual
      );
    ELSE
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING ((%s) OR (SELECT internal.is_platform_admin())) WITH CHECK ((%s) OR (SELECT internal.is_platform_admin()))',
        policy_row.policyname, policy_row.tablename, policy_row.qual, policy_row.with_check
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('internal.enforce_policy_election_rules()'::regprocedure)
  INTO function_sql;

  function_sql := replace(
    function_sql,
    'v_can_self_approve boolean;',
    'v_can_self_approve boolean;' || chr(10) || '  v_is_trial_admin boolean;'
  );
  function_sql := replace(
    function_sql,
    'v_has_multi_user := internal.org_has_feature(''multi_user'');',
    'v_is_trial_admin := v_is_admin AND internal.org_plan_key(v_org_id) = ''trial'';' || chr(10) || '    v_has_multi_user := internal.org_has_feature(''multi_user'', v_org_id);'
  );
  function_sql := replace(
    function_sql,
    'v_can_self_approve := (NOT v_has_multi_user) OR (v_active_user_count <= 1);',
    'v_can_self_approve := v_is_trial_admin OR (NOT v_has_multi_user) OR (v_active_user_count <= 1);'
  );
  function_sql := replace(
    function_sql,
    '''APPROVE'',
        jsonb_build_object(''status'', OLD.status)',
    'CASE WHEN v_is_trial_admin THEN ''Self-approved (trial, admin)'' ELSE ''APPROVE'' END,
        jsonb_build_object(''status'', OLD.status)'
  );

  EXECUTE function_sql;
END $$;
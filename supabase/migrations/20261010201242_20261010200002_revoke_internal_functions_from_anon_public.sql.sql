/*
# Revoke EXECUTE on internal.* functions from anon and PUBLIC

Trigger functions and security helpers in the internal schema are not intended
to be callable by the anon role or via blanket PUBLIC grants.

Rule: revoke from PUBLIC and anon only; preserve authenticated grants.
*/

REVOKE EXECUTE ON FUNCTION internal.enforce_plan_feature()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.enforce_lease_limit()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.enforce_policy_election_rules()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.enforce_role_permissions_guard()     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.has_permission(perm_key text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.org_has_feature(feature text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.org_has_feature(feature text, target_org_id uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.org_plan_key()                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.org_plan_key(target_org_id uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.trial_days()                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.write_audit_log()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.set_lessor_org_id()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.set_organization_id()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.set_user_id()                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_audit_log_mutation()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_month_end_mutation()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_lt()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_period_locked_mutation_je()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_posted_transaction_mutation() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_user_id_change()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.prevent_zero_amount_recognition()    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION internal.reopen_month_end(p_doc_id uuid, p_reason text) FROM PUBLIC, anon;

-- Re-grant to authenticated what they legitimately need for RLS evaluation
GRANT EXECUTE ON FUNCTION internal.has_permission(perm_key text)        TO authenticated;
GRANT EXECUTE ON FUNCTION internal.org_has_feature(feature text)        TO authenticated;
GRANT EXECUTE ON FUNCTION internal.org_has_feature(feature text, target_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.org_plan_key()                       TO authenticated;
GRANT EXECUTE ON FUNCTION internal.org_plan_key(target_org_id uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION internal.trial_days()                         TO authenticated;

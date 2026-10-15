/*
# Security Fixes Round 5 — Audit Remediation

## Summary
This migration addresses High and Medium severity findings from the 2026-10-08 quality audit.

## Changes

### 1. Fix org_plan_key() fallback (High — #21)
The no-arg `internal.org_plan_key()` falls back to `'trial'` via COALESCE when
`current_org_id()` returns NULL (service-role context where `auth.uid()` is NULL).
This means any trigger or RLS policy calling `org_plan_key()` from a service-role
insert gets `'trial'`, which grants `multi_user` and all features.

**Fix:** Change the COALESCE fallback from `'trial'` to `NULL`. When no org can
be resolved, the function returns NULL, and `org_has_feature` returns FALSE for
NULL plan keys — failing closed instead of granting trial access.

### 2. Fix enforce_plan_feature fallback (Medium — #22)
The trigger's fallback branch calls `org_has_feature(feature_name)` (no org arg)
when `NEW.organization_id` is NULL. In service-role context this hits the
`org_plan_key()` → `'trial'` bug.

**Fix:** Remove the fallback branch. When `org_id` is NULL, raise an exception
instead of falling back to auth.uid()-based check.

### 3. Revoke EXECUTE on exposed SECURITY DEFINER functions (Medium — #12, #13, #17)
- `public.admin_set_user_role`: callable by `authenticated` via REST. Has org-scope
  guard inside, but should only be called from edge functions.
- `public.get_all_users_with_plans`: callable by `authenticated` via REST. Has
  `is_platform_admin()` guard inside, but should only be called from edge functions.
- `internal.enforce_plan_feature`: trigger function callable by `authenticated`.
  Trigger functions don't need EXECUTE grants — they fire on table events.

### 4. Add missing FKs on lessors table (Medium — #25)
`lessors.organization_id` and `lessors.user_id` have no FK constraints. The columns
are NOT NULL but have no referential integrity to `organizations(id)` or `auth.users(id)`.

### 5. Fix companies.organization_id ON DELETE (Medium — #30)
`companies.organization_id` FK uses `ON DELETE SET NULL`, which would create an
orphaned company with NULL org if an organization is deleted, violating tenant
isolation. Changed to `ON DELETE RESTRICT` to prevent deleting an org that still
has companies.

## Security Impact
- Closes a privilege escalation where service-role triggers grant trial features
- Reduces attack surface by removing unnecessary REST-exposed SECURITY DEFINER functions
- Enforces referential integrity on lessors table
- Prevents orphaned companies with NULL organization_id
*/

/*
# Fix Regressions from Version 106 — RPC Grants + org_plan_key Trial Resolution

## Problem A: Platform Admin and User Management broken
Version 106 revoked EXECUTE on `public.get_all_users_with_plans` and
`public.admin_set_user_role` from `authenticated`, but the browser calls
these RPCs directly via `supabase.rpc(...)`. Both functions already check
`is_platform_admin()` / same-org admin internally, which is the real protection.

## Problem B: Trial orgs get NULL plan_key → all features blocked
`internal.org_plan_key(org_id)` returns NULL when no subscription row exists
for the org. The app's `resolvePlanKey(null)` returns `'trial'`, but the
database returns NULL, so the trigger and RLS policies see no features and
block approval, modifications, etc.

The fix: when an org EXISTS but has no subscription row (or an expired trial),
`org_plan_key` should return `'trial'` — matching the app logic. A NULL org_id
(no such organization) must still return NULL (fail closed).

## Changes

### 1. Re-grant EXECUTE on browser-called functions
- `public.get_all_users_with_plans()` → GRANT EXECUTE TO authenticated
- `public.admin_set_user_role(uuid, text, jsonb)` → GRANT EXECUTE TO authenticated
- Keep revoked from `anon` (these require authentication)

### 2. Rewrite `internal.org_plan_key(target_org_id uuid)`
- If `target_org_id` IS NULL → return NULL (fail closed)
- If the org exists but has no subscription row → return `'trial'`
- If the org has a subscription:
  - `trialing` + `trial_ends_at > now()` → `'trial'`
  - `active` + period not ended → `plan_key`
  - `past_due` + within 7-day grace → `plan_key`
  - Otherwise (expired/cancelled) → `'trial'` (matches app's fallback)

### 3. Rewrite `internal.org_plan_key()` (no-args version)
- Same logic but uses `internal.current_org_id()` as the target

### Security
- No RLS policy changes
- Both re-granted functions check authorization internally
- NULL org_id still fails closed
*/

-- 1. Re-grant EXECUTE on browser-called RPCs
GRANT EXECUTE ON FUNCTION public.get_all_users_with_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, jsonb) TO authenticated;

-- Ensure anon stays revoked
REVOKE EXECUTE ON FUNCTION public.get_all_users_with_plans() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, jsonb) FROM anon;

-- 2. Rewrite org_plan_key(target_org_id uuid) — return 'trial' for existing orgs with no subscription
CREATE OR REPLACE FUNCTION internal.org_plan_key(target_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
SELECT CASE
  WHEN target_org_id IS NULL THEN NULL
  WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_org_id) THEN NULL
  ELSE COALESCE(
    (
      SELECT CASE
        WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
        WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.plan_key
        WHEN s.status = 'past_due' AND s.current_period_end IS NOT NULL AND s.current_period_end > now() - interval '7 days' THEN s.plan_key
        ELSE NULL
      END
      FROM public.subscriptions s
      WHERE s.organization_id = target_org_id
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'trial'
  )
END
$function$;

-- 3. Rewrite org_plan_key() (no-args) — uses current_org_id
CREATE OR REPLACE FUNCTION internal.org_plan_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'public'
AS $function$
SELECT internal.org_plan_key(internal.current_org_id())
$function$;

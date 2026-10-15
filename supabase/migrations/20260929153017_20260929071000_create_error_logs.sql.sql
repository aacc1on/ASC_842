/*
# Create Error Logs Table

## Purpose
Stores in-app errors captured by the frontend ErrorBoundary and global
window error/unhandledrejection handlers. Allows admins to review errors
across their organization.

## 1. New Table
- `public.error_logs`
  - `id` bigint identity primary key
  - `organization_id` uuid → references `organizations(id)` (nullable for errors before org assignment)
  - `user_id` uuid → the authenticated user who triggered the error
  - `message` text NOT NULL, max 2000 chars
  - `stack` text, max 8000 chars
  - `route` text → current URL path when the error occurred
  - `user_agent` text → browser user agent string
  - `created_at` timestamptz default now()

## 2. Security — RLS
- RLS enabled on `error_logs`.
- INSERT: authenticated users may insert only rows where `user_id = auth.uid()`
  AND `organization_id = internal.current_org_id()`.
- SELECT: only admins (`role = 'admin'`) within the same organization.
- No UPDATE or DELETE policies for clients.
- UPDATE, DELETE, TRUNCATE revoked from `anon`, `authenticated`, `service_role`.

## Important Notes
1. The frontend rate-limits to 10 errors per minute per browser session
   before inserting.
2. The frontend never sends passwords or tokens in the error payload.
3. No subscription_required policies are added.
4. No existing data is modified or deleted.
*/

-- ============================================================================
-- 1. Create error_logs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.error_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id         uuid,
  message         text NOT NULL CHECK (char_length(message) <= 2000),
  stack           text CHECK (stack IS NULL OR char_length(stack) <= 8000),
  route           text,
  user_agent      text,
  created_at      timestamptz DEFAULT now()
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_error_logs_org_created
  ON public.error_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_user_created
  ON public.error_logs (user_id, created_at DESC);

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: admin-only, same organization
DROP POLICY IF EXISTS "error_logs_select_admin" ON public.error_logs;
CREATE POLICY "error_logs_select_admin"
  ON public.error_logs FOR SELECT
  TO authenticated
  USING (
    organization_id = internal.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role = 'admin'
        AND user_profiles.organization_id = error_logs.organization_id
    )
  );

-- INSERT: authenticated users, own row, correct org
DROP POLICY IF EXISTS "error_logs_insert_own" ON public.error_logs;
CREATE POLICY "error_logs_insert_own"
  ON public.error_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = internal.current_org_id()
  );

-- Revoke all write privileges except INSERT
REVOKE UPDATE, DELETE, TRUNCATE ON public.error_logs FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.error_logs FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.error_logs FROM service_role;

/*
# Add Related Party fields to leases and create lessors table

## Purpose
1. Add "Related Party" Yes/No flag and "Related Party Name" to the leases table so
   users can track whether a lease is with a related party and name that party.
2. Create a dedicated `lessors` table to store lessor master data with the ability
   to mark lessors active or inactive. This powers the new Lessor module in the menu.

## Changes to existing table: `public.leases`
- `related_party` (boolean, NOT NULL, default false) — Yes/No flag
- `related_party_name` (text, nullable) — name of the related party, required only when related_party = true

## New table: `public.lessors`
- `id` (uuid PK)
- `organization_id` (uuid NOT NULL) — tenant isolation
- `user_id` (uuid NOT NULL DEFAULT auth.uid()) — owner
- `lessor_name` (text NOT NULL)
- `lessor_type` (text NOT NULL, default 'corporate') — corporate | individual | government | financial_institution | other
- `contact_email` (text, nullable)
- `contact_phone` (text, nullable)
- `address` (text, nullable)
- `is_active` (boolean NOT NULL DEFAULT true)
- `notes` (text, nullable)
- `created_at` (timestamptz NOT NULL DEFAULT now())
- `updated_at` (timestamptz NOT NULL DEFAULT now())

## Security
- RLS enabled on `lessors` with organization-scoped policies (SELECT/INSERT/UPDATE/DELETE)
  using `internal.current_org_id()` and `internal.is_manage_or_admin()` — same pattern
  as other tenant-isolated tables in this project.
- No RLS changes needed on `leases` — existing policies already cover the new columns
  since they are ordinary data columns.
*/

-- 1. Add related party columns to leases
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS related_party boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_party_name text;

-- 2. Create lessors table
CREATE TABLE IF NOT EXISTS public.lessors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  lessor_name text NOT NULL,
  lessor_type text NOT NULL DEFAULT 'corporate',
  contact_email text,
  contact_phone text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lessors ENABLE ROW LEVEL SECURITY;

-- Organization-scoped SELECT
DROP POLICY IF EXISTS "tenant_select_lessors" ON public.lessors;
CREATE POLICY "tenant_select_lessors"
  ON public.lessors FOR SELECT
  TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()));

-- Manage/admin INSERT
DROP POLICY IF EXISTS "insert_lessors" ON public.lessors;
CREATE POLICY "insert_lessors"
  ON public.lessors FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT internal.is_manage_or_admin()));

-- Manage/admin UPDATE
DROP POLICY IF EXISTS "update_lessors" ON public.lessors;
CREATE POLICY "update_lessors"
  ON public.lessors FOR UPDATE
  TO authenticated
  USING ((SELECT internal.is_manage_or_admin()))
  WITH CHECK ((SELECT internal.is_manage_or_admin()));

-- Manage/admin DELETE
DROP POLICY IF EXISTS "delete_lessors" ON public.lessors;
CREATE POLICY "delete_lessors"
  ON public.lessors FOR DELETE
  TO authenticated
  USING ((SELECT internal.is_manage_or_admin()));

-- Subscription-required INSERT/UPDATE/DELETE (same pattern as accounting_policy_elections)
DROP POLICY IF EXISTS "subscription_required_insert_lessors" ON public.lessors;
CREATE POLICY "subscription_required_insert_lessors"
  ON public.lessors FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_update_lessors" ON public.lessors;
CREATE POLICY "subscription_required_update_lessors"
  ON public.lessors FOR UPDATE
  TO authenticated
  USING ((SELECT internal.org_has_active_subscription()))
  WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_delete_lessors" ON public.lessors;
CREATE POLICY "subscription_required_delete_lessors"
  ON public.lessors FOR DELETE
  TO authenticated
  USING ((SELECT internal.org_has_active_subscription()));

-- Organization isolation trigger (same pattern as other tables)
CREATE OR REPLACE FUNCTION internal.set_lessor_org_id()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      NEW.organization_id := internal.current_org_id();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'organization_id cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_lessor_organization_id ON public.lessors;
CREATE TRIGGER set_lessor_organization_id
  BEFORE INSERT OR UPDATE ON public.lessors
  FOR EACH ROW EXECUTE FUNCTION internal.set_lessor_org_id();

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_lessors_organization_id ON public.lessors (organization_id);
CREATE INDEX IF NOT EXISTS idx_lessors_is_active ON public.lessors (is_active);

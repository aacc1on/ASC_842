/*
# ASC 842 Accounting Policy Elections

## Purpose
Creates the `accounting_policy_elections` table to record, approve, and disclose
ASC 842 accounting policy elections by class of underlying asset (fixed asset type).

## New Columns
- `companies.entity_type` (text, nullable) — the entity's reporting classification:
  'public_business_entity', 'non_public_business_entity', 'not_for_profit_other'.
  Determines eligibility for the risk-free rate election.

## New Table: `accounting_policy_elections`
- `id` (uuid PK)
- `organization_id` (uuid NOT NULL, FK to organizations) — auto-set by trigger
- `company_id` (uuid NOT NULL, FK to companies)
- `fixed_asset_type_id` (uuid NOT NULL, FK to fixed_asset_types) — the asset class
- `policy_type` (text NOT NULL) — 'SHORT_TERM_LEASE' | 'COMBINE_LEASE_NONLEASE' | 'RISK_FREE_RATE'
- `election_value` (boolean NOT NULL) — true = elected/combined; false = not elected/separated
- `effective_from` (date NOT NULL)
- `effective_to` (date, nullable) — set when superseded by a new approved version
- `status` (text NOT NULL, default 'draft') — 'draft' | 'pending_approval' | 'approved' | 'inactive'
- `policy_version` (int NOT NULL) — auto-increments per (company, asset type, policy type)
- `notes` (text, nullable)
- `change_reason` (text, nullable) — required when changing an approved policy
- `supporting_document_id` (uuid, nullable, FK to documents)
- `prepared_by` (uuid, nullable) — user who prepared the election
- `prepared_at` (timestamptz, nullable)
- `approved_by` (uuid, nullable) — user who approved (must differ from prepared_by)
- `approved_at` (timestamptz, nullable)
- `created_by` (uuid, nullable)
- `created_at` (timestamptz, default now())
- `updated_by` (uuid, nullable)
- `updated_at` (timestamptz, default now())

## Indexes
- `idx_policy_elections_lookup` on (company_id, fixed_asset_type_id, policy_type, effective_from)
- `idx_policy_elections_org` on (organization_id)

## Security (RLS)
- `tenant_isolation` RESTRICTIVE policy (same pattern as all business tables)
- `subscription_required` RESTRICTIVE INSERT/UPDATE policies (same pattern)
- Permissive SELECT for org members (is_manage_or_admin or own user_id)
- Permissive INSERT/UPDATE for admin and manage roles only
- No DELETE policy — elections are never deleted, only superseded

## Guard Triggers
1. `set_organization_id` — auto-set organization_id on INSERT, prevent change on UPDATE
2. `enforce_policy_election_rules` — enforces:
   - Only admins can set status to 'approved'
   - approved_by must differ from prepared_by (segregation of duties)
   - Approved rows cannot be edited except to set effective_to or status to 'inactive'
   - When a new version is approved, set effective_to of the previously approved
     version of the same (company, asset type, policy type) to the day before
     the new effective_from
   - policy_version auto-increments per (company, asset type, policy type)
   - RISK_FREE_RATE election_value=true cannot be approved when company
     entity_type is 'public_business_entity' or null

## Audit Log
- `write_audit_log` trigger attached (AFTER INSERT/UPDATE/DELETE)

## Important Notes
1. No existing data is modified or deleted.
2. The entity_type column is added with IF NOT EXISTS for idempotency.
3. Fixed asset types ARE the asset classes — no separate asset class table.
4. All trigger functions use SECURITY DEFINER with SET search_path = '' for safety.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE public.companies ADD COLUMN entity_type text
      CHECK (entity_type IS NULL OR entity_type IN ('public_business_entity','non_public_business_entity','not_for_profit_other'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.accounting_policy_elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fixed_asset_type_id uuid NOT NULL REFERENCES public.fixed_asset_types(id) ON DELETE CASCADE,
  policy_type text NOT NULL CHECK (policy_type IN ('SHORT_TERM_LEASE','COMBINE_LEASE_NONLEASE','RISK_FREE_RATE')),
  election_value boolean NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','inactive')),
  policy_version int NOT NULL,
  notes text,
  change_reason text,
  supporting_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  prepared_by uuid,
  prepared_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_policy_elections ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_policy_elections_lookup
  ON public.accounting_policy_elections (company_id, fixed_asset_type_id, policy_type, effective_from);
CREATE INDEX IF NOT EXISTS idx_policy_elections_org
  ON public.accounting_policy_elections (organization_id);

-- tenant_isolation RESTRICTIVE policy
DROP POLICY IF EXISTS "tenant_isolation_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "tenant_isolation_accounting_policy_elections"
  ON public.accounting_policy_elections
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT internal.current_org_id()))
  WITH CHECK (organization_id = (SELECT internal.current_org_id()));

-- subscription_required RESTRICTIVE policies
DROP POLICY IF EXISTS "subscription_required_insert_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_insert_accounting_policy_elections"
  ON public.accounting_policy_elections
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.org_has_active_subscription()));

DROP POLICY IF EXISTS "subscription_required_update_accounting_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "subscription_required_update_accounting_policy_elections"
  ON public.accounting_policy_elections
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT internal.org_has_active_subscription()))
  WITH CHECK ((SELECT internal.org_has_active_subscription()));

-- Permissive SELECT for org members
DROP POLICY IF EXISTS "select_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "select_policy_elections"
  ON public.accounting_policy_elections FOR SELECT TO authenticated
  USING (
    (SELECT internal.is_manage_or_admin())
    OR prepared_by = auth.uid()
    OR created_by = auth.uid()
  );

-- Permissive INSERT for admin and manage roles
DROP POLICY IF EXISTS "insert_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "insert_policy_elections"
  ON public.accounting_policy_elections FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.is_manage_or_admin()));

-- Permissive UPDATE for admin and manage roles
DROP POLICY IF EXISTS "update_policy_elections" ON public.accounting_policy_elections;
CREATE POLICY "update_policy_elections"
  ON public.accounting_policy_elections FOR UPDATE TO authenticated
  USING ((SELECT internal.is_manage_or_admin()))
  WITH CHECK ((SELECT internal.is_manage_or_admin()));

-- No DELETE policy: elections are never deleted, only superseded.
REVOKE DELETE ON public.accounting_policy_elections FROM anon, authenticated;

-- Attach the existing set_organization_id trigger
DROP TRIGGER IF EXISTS set_organization_id ON public.accounting_policy_elections;
CREATE TRIGGER set_organization_id
  BEFORE INSERT OR UPDATE ON public.accounting_policy_elections
  FOR EACH ROW EXECUTE FUNCTION internal.set_organization_id();

-- Guard trigger: enforce policy election business rules
CREATE OR REPLACE FUNCTION internal.enforce_policy_election_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean;
  v_company_entity_type text;
  v_next_version int;
  v_prev_id uuid;
BEGIN
  v_is_admin := (SELECT internal.is_admin());

  -- Set prepared_by / prepared_at on insert if not provided
  IF TG_OP = 'INSERT' THEN
    IF NEW.prepared_by IS NULL THEN
      NEW.prepared_by := auth.uid();
    END IF;
    IF NEW.prepared_at IS NULL THEN
      NEW.prepared_at := now();
    END IF;
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;

    -- Auto-increment policy_version per (company, asset type, policy type)
    SELECT COALESCE(MAX(policy_version), 0) + 1 INTO v_next_version
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type;
    NEW.policy_version := v_next_version;
  END IF;

  -- Set updated_by / updated_at on update
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
  END IF;

  -- Only admins can set status to 'approved'
  IF NEW.status = 'approved' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only administrators can approve policy elections';
  END IF;

  -- When status is approved, set approved_by and approved_at if not already set
  IF NEW.status = 'approved' AND NEW.approved_by IS NULL THEN
    NEW.approved_by := auth.uid();
  END IF;
  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  -- Segregation of duties: approved_by must differ from prepared_by
  IF NEW.status = 'approved' AND NEW.approved_by = NEW.prepared_by THEN
    RAISE EXCEPTION 'Segregation of duties: the approver must differ from the preparer';
  END IF;

  -- RISK_FREE_RATE with election_value=true cannot be approved for public business entity or null
  IF NEW.status = 'approved' AND NEW.policy_type = 'RISK_FREE_RATE' AND NEW.election_value = true THEN
    SELECT c.entity_type INTO v_company_entity_type
    FROM public.companies c WHERE c.id = NEW.company_id;
    IF v_company_entity_type IS NULL OR v_company_entity_type = 'public_business_entity' THEN
      RAISE EXCEPTION 'Risk-free rate election is not available for public business entities';
    END IF;
  END IF;

  -- Approved rows cannot be edited except to set effective_to or status to inactive
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    -- Allow setting effective_to
    -- Allow changing status to 'inactive'
    -- Block all other changes
    IF NEW.status != OLD.status AND NEW.status != 'inactive' THEN
      RAISE EXCEPTION 'Approved policy elections can only be set to inactive';
    END IF;
    IF NEW.status = OLD.status THEN
      -- Status unchanged: only effective_to can change
      IF NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
         AND NEW.election_value IS NOT DISTINCT FROM OLD.election_value
         AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
         AND NEW.notes IS NOT DISTINCT FROM OLD.notes
         AND NEW.change_reason IS NOT DISTINCT FROM OLD.change_reason
         AND NEW.supporting_document_id IS NOT DISTINCT FROM OLD.supporting_document_id
         AND NEW.prepared_by IS NOT DISTINCT FROM OLD.prepared_by
         AND NEW.policy_type IS NOT DISTINCT FROM OLD.policy_type
         AND NEW.fixed_asset_type_id IS NOT DISTINCT FROM OLD.fixed_asset_type_id
         AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
      THEN
        -- Only updated_at/updated_by changed, which is fine
        NULL;
      ELSIF NEW.effective_to IS DISTINCT FROM OLD.effective_to
         AND NEW.election_value IS NOT DISTINCT FROM OLD.election_value
         AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
         AND NEW.notes IS NOT DISTINCT FROM OLD.notes
         AND NEW.policy_type IS NOT DISTINCT FROM OLD.policy_type
         AND NEW.fixed_asset_type_id IS NOT DISTINCT FROM OLD.fixed_asset_type_id
         AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
      THEN
        -- effective_to changed, that's allowed
        NULL;
      ELSE
        RAISE EXCEPTION 'Approved policy elections cannot be edited except to set effective_to or change status to inactive';
      END IF;
    END IF;
  END IF;

  -- When a new version is approved, close the previous approved version
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status != 'approved' THEN
    SELECT id INTO v_prev_id
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type
      AND status = 'approved'
      AND id != NEW.id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_prev_id IS NOT NULL THEN
      UPDATE public.accounting_policy_elections
      SET effective_to = (NEW.effective_from - interval '1 day')::date,
          updated_at = now()
      WHERE id = v_prev_id;
    END IF;
  END IF;

  -- Same for INSERT with status approved
  IF TG_OP = 'INSERT' AND NEW.status = 'approved' THEN
    SELECT id INTO v_prev_id
    FROM public.accounting_policy_elections
    WHERE company_id = NEW.company_id
      AND fixed_asset_type_id = NEW.fixed_asset_type_id
      AND policy_type = NEW.policy_type
      AND status = 'approved'
      AND id != NEW.id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_prev_id IS NOT NULL THEN
      UPDATE public.accounting_policy_elections
      SET effective_to = (NEW.effective_from - interval '1 day')::date,
          updated_at = now()
      WHERE id = v_prev_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.enforce_policy_election_rules() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_policy_election_rules ON public.accounting_policy_elections;
CREATE TRIGGER enforce_policy_election_rules
  BEFORE INSERT OR UPDATE ON public.accounting_policy_elections
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_policy_election_rules();

-- Audit log trigger
DROP TRIGGER IF EXISTS write_audit_log ON public.accounting_policy_elections;
CREATE TRIGGER write_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.accounting_policy_elections
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

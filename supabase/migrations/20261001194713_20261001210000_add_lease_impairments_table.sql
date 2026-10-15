/*
# Add lease_impairments table for ROU asset impairment tracking

## Purpose
Supports ASC 842-20-35-9 to 35-11 (impairment of ROU assets). Stores
impairment records that can be posted to journal entries and the
amortization schedule via the `applyImpairment` function.

## 1. New Tables

### `lease_impairments`
- `id` (uuid, PK, auto-generated)
- `organization_id` (uuid, NOT NULL, FK → organizations(id))
- `lease_id` (uuid, NOT NULL, FK → leases(id))
- `impairment_date` (date, NOT NULL) — date the impairment is recognized
- `impairment_amount` (numeric, NOT NULL, CHECK > 0) — amount of ROU write-down
- `reason` (text, nullable) — explanation for the impairment
- `posted` (boolean, NOT NULL, default false) — whether journal entries have been posted
- `created_at` (timestamptz, NOT NULL, default now())

## 2. Indexes
- Index on `lease_id` for efficient lookup of impairments per lease.

## 3. Security (RLS)
- Enable RLS on `lease_impairments`.
- Four CRUD policies (SELECT/INSERT/UPDATE/DELETE) scoped to `authenticated`
  role, using the same ownership pattern as `contract_modifications`.
- Tenant isolation policy restricting access to the current organization.
- Subscription-required policies for INSERT/UPDATE/DELETE matching the
  existing pattern.
*/

CREATE TABLE IF NOT EXISTS lease_impairments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  lease_id uuid NOT NULL REFERENCES leases(id),
  impairment_date date NOT NULL,
  impairment_amount numeric NOT NULL CHECK (impairment_amount > 0),
  reason text,
  posted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lease_impairments ENABLE ROW LEVEL SECURITY;

-- Index for efficient per-lease lookups
CREATE INDEX IF NOT EXISTS idx_lease_impairments_lease_id ON lease_impairments(lease_id);

-- Consolidated CRUD policies (ownership-based, matching contract_modifications pattern)
DROP POLICY IF EXISTS "consolidated_select_lease_impairments" ON lease_impairments;
CREATE POLICY "consolidated_select_lease_impairments"
  ON lease_impairments FOR SELECT
  TO authenticated
  USING (internal.has_data_access() OR ((SELECT auth.uid() AS uid) = (SELECT user_id FROM leases WHERE leases.id = lease_impairments.lease_id)));

DROP POLICY IF EXISTS "consolidated_insert_lease_impairments" ON lease_impairments;
CREATE POLICY "consolidated_insert_lease_impairments"
  ON lease_impairments FOR INSERT
  TO authenticated
  WITH CHECK (internal.is_manage_or_admin() OR ((SELECT auth.uid() AS uid) = (SELECT user_id FROM leases WHERE leases.id = lease_impairments.lease_id)));

DROP POLICY IF EXISTS "consolidated_update_lease_impairments" ON lease_impairments;
CREATE POLICY "consolidated_update_lease_impairments"
  ON lease_impairments FOR UPDATE
  TO authenticated
  USING (internal.is_manage_or_admin() OR ((SELECT auth.uid() AS uid) = (SELECT user_id FROM leases WHERE leases.id = lease_impairments.lease_id)))
  WITH CHECK (internal.is_manage_or_admin() OR ((SELECT auth.uid() AS uid) = (SELECT user_id FROM leases WHERE leases.id = lease_impairments.lease_id)));

DROP POLICY IF EXISTS "consolidated_delete_lease_impairments" ON lease_impairments;
CREATE POLICY "consolidated_delete_lease_impairments"
  ON lease_impairments FOR DELETE
  TO authenticated
  USING (internal.is_manage_or_admin() OR ((SELECT auth.uid() AS uid) = (SELECT user_id FROM leases WHERE leases.id = lease_impairments.lease_id)));

-- Tenant isolation policy (organization-scoped, matching all other tables)
DROP POLICY IF EXISTS "tenant_isolation_lease_impairments" ON lease_impairments;
CREATE POLICY "tenant_isolation_lease_impairments"
  ON lease_impairments FOR ALL
  TO authenticated
  USING (organization_id = (SELECT internal.current_org_id() AS current_org_id))
  WITH CHECK (organization_id = (SELECT internal.current_org_id() AS current_org_id));

-- Subscription-required policies (matching existing pattern)
DROP POLICY IF EXISTS "subscription_required_insert_lease_impairments" ON lease_impairments;
CREATE POLICY "subscription_required_insert_lease_impairments"
  ON lease_impairments FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT internal.org_has_active_subscription() AS org_has_active_subscription));

DROP POLICY IF EXISTS "subscription_required_update_lease_impairments" ON lease_impairments;
CREATE POLICY "subscription_required_update_lease_impairments"
  ON lease_impairments FOR UPDATE
  TO authenticated
  USING ((SELECT internal.org_has_active_subscription() AS org_has_active_subscription))
  WITH CHECK ((SELECT internal.org_has_active_subscription() AS org_has_active_subscription));

DROP POLICY IF EXISTS "subscription_required_delete_lease_impairments" ON lease_impairments;
CREATE POLICY "subscription_required_delete_lease_impairments"
  ON lease_impairments FOR DELETE
  TO authenticated
  USING ((SELECT internal.org_has_active_subscription() AS org_has_active_subscription));

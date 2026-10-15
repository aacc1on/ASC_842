# Database Schema

All tables are in the `public` schema. Row Level Security (RLS) is enabled on every table. Security helper functions live in the `internal` schema.

## Security Architecture

### Helper Functions (internal schema)

| Function | Purpose |
|---|---|
| `internal.current_org_id()` | Returns the caller's organization ID from JWT claims |
| `internal.has_data_access()` | Returns `true` if the caller's role is `admin` or `manage` |
| `internal.org_has_active_subscription()` | Returns `true` if the caller's org has an active/trialing/past-due (within 7-day grace) subscription |

### Policy Pattern

Every data table follows the same pattern:

1. **Restrictive `tenant_isolation_<table>`** (`FOR ALL`) — enforces `organization_id = internal.current_org_id()`. This is AND-combined with all permissive policies, so cross-organization access is always blocked.

2. **Restrictive `subscription_required_<action>_<table>`** (`INSERT`/`UPDATE`/`DELETE`) — blocks writes when `internal.org_has_active_subscription()` returns false. Users can still read during an inactive subscription.

3. **Permissive policies** (one per action) — grant access based on ownership (`auth.uid() = user_id`) or data-access role (`internal.has_data_access()`). SELECT policies use `internal.has_data_access() OR auth.uid() = user_id` so admin/manage users see all org data while view-only users see their own rows.

---

## Tables

### organizations

Top-level tenant entity. Each user belongs to one organization.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Organization ID |
| `name` | text | Organization name |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: Enabled. Restrictive tenant isolation. No permissive write policies (organizations are managed via migrations/service role only).

---

### user_profiles

Extended profile data for each auth user, linked to an organization.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Profile ID |
| `user_id` | uuid | References `auth.users(id)` |
| `full_name` | text | User's full name |
| `email` | text | User's email (synced from auth) |
| `phone_number` | text | Phone number |
| `company_name` | text | Company name (free text) |
| `job_title` | text | Job title |
| `role` | text | `admin`, `manage`, or `view` |
| `permissions` | jsonb | Granular permission flags |
| `organization_id` | uuid | References `organizations(id)` |
| `theme`, `date_format`, `currency`, `timezone`, `language` | various | UI preferences |
| `email_notifications`, `lease_expiry_alerts`, `payment_reminders`, `monthly_reports` | boolean | Notification settings |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Restrictive tenant isolation + subscription enforcement. Permissive SELECT allows `has_data_access() OR auth.uid() = user_id`. Admin-only INSERT/UPDATE/DELETE for user management.

---

### user_activity_logs

Audit trail of user actions within the app.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Log ID |
| `user_id` | uuid | References `auth.users(id)` |
| `activity_type` | text | Type of activity (e.g., `profile_update`, `user_created`) |
| `activity_description` | text | Human-readable description |
| `ip_address` | text | Request IP |
| `user_agent` | text | Browser user agent |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard restrictive isolation + subscription enforcement. Permissive policies use ownership + data-access role.

---

### leases

Core lease records — the primary entity of the application.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Lease ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `lease_name` | text | Unique name per user |
| `lease_description` | text | Description |
| `lessor_name` | text | Lessor name |
| `lease_start_date` | date | Lease commencement date |
| `lease_end_date` | date | Lease end date |
| `lease_term_months` | integer | Term in months |
| `payment_amount` | numeric | Periodic payment amount |
| `payment_frequency` | text | `monthly`, `quarterly`, `semi_annually`, `annually`, `weekly` |
| `payment_timing` | text | Payment timing (advance/arrears) |
| `incremental_borrowing_rate` | numeric | Annual discount rate (%) |
| `lease_classification` | text | `operating` or `finance` |
| `initial_direct_costs` | numeric | Initial direct costs |
| `lease_incentives` | numeric | Lease incentives received |
| `rou_asset` | numeric | Right-of-use asset value |
| `lease_liability` | numeric | Lease liability value |
| `status` | text | `active`, `terminated`, `expired` |
| `transfer_ownership` | boolean | Classification criterion |
| `purchase_option` | boolean | Classification criterion |
| `purchase_option_price` | numeric | Classification criterion |
| `asset_fair_value` | numeric | Classification criterion |
| `asset_economic_life_months` | integer | Classification criterion (default 0, never negative) |
| `specialized_asset` | boolean | Classification criterion |
| `residual_value_guarantee` | numeric | Residual value guarantee |
| `auto_classified` | boolean | Whether classification was automatic |
| `lessor_type` | text | Lessor type |
| `branch_id` | uuid | References `branches(id)` |
| `asset_market_value` | numeric | Asset market value |
| `fixed_asset_type_id` | uuid | References `fixed_asset_types(id)` |
| `company_id` | uuid | References `companies(id)` |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard restrictive isolation + subscription enforcement. Consolidated permissive policies for all CRUD operations.

---

### lease_payments

Individual lease payment records.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Payment ID |
| `lease_id` | uuid | References `leases(id)` |
| `payment_date` | date | Payment date |
| `payment_amount` | numeric | Amount |
| `payment_type` | text | Payment type |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### lease_payment_schedules

Variable payment tranches for leases with tiered payment structures.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Schedule entry ID |
| `lease_id` | uuid | References `leases(id)` |
| `from_month` | integer | Start month |
| `to_month` | integer | End month |
| `payment_amount` | numeric | Payment for this tranche |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### amortization_schedules

Generated amortization schedule rows for each lease.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Row ID |
| `lease_id` | uuid | References `leases(id)` |
| `period_number` | integer | Period number (1-based) |
| `period_date` | date | Period date |
| `beginning_liability` | numeric | Beginning lease liability balance |
| `payment_amount` | numeric | Payment for this period |
| `interest_expense` | numeric | Interest expense for this period |
| `principal_reduction` | numeric | Principal reduction |
| `ending_liability` | numeric | Ending lease liability balance |
| `rou_asset_balance` | numeric | ROU asset balance after this period |
| `depreciation_expense` | numeric | Depreciation/amortization for this period |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### journal_entries

Journal entries generated from lease calculations.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Entry ID |
| `lease_id` | uuid | References `leases(id)` |
| `amortization_id` | uuid | References `amortization_schedules(id)` |
| `entry_date` | date | Entry date |
| `entry_type` | text | Entry type (e.g., `lease_commencement`, `monthly_interest`, `monthly_payment`, `depreciation`) |
| `account_name` | text | Account name |
| `debit_amount` | numeric | Debit amount |
| `credit_amount` | numeric | Credit amount |
| `description` | text | Entry description |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### transactions

Transaction-level records for the transaction journal view.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Transaction ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `lease_id` | uuid | References `leases(id)` |
| `transaction_date` | date | Transaction date |
| `transaction_type` | text | Transaction type |
| `account_debited` | text | Debit account |
| `account_credited` | text | Credit account |
| `debit_amount` | numeric | Debit amount |
| `credit_amount` | numeric | Credit amount |
| `description` | text | Description |
| `reference_number` | text | Reference number |
| `period` | text | Accounting period |
| `is_reversed` | boolean | Whether this transaction was reversed |
| `reversal_of` | uuid | References `transactions(id)` if this is a reversal |
| `month_end_document_id` | uuid | References `month_end_documents(id)` |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern. Server-side filtering via `get_filtered_transactions` RPC function.

---

### lease_transactions

Lease-level transaction records linked to modifications.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Transaction ID |
| `lease_id` | uuid | References `leases(id)` |
| `modification_id` | uuid | References `contract_modifications(id)` |
| `transaction_date` | date | Transaction date |
| `transaction_type` | text | Transaction type |
| `description` | text | Description |
| `account_debited` | text | Debit account |
| `account_credited` | text | Credit account |
| `amount` | numeric | Amount |
| `user_id` | uuid | Owner (references `auth.users`) |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### lease_modifications

Historical lease modification records (pre-contract-modifications module).

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Modification ID |
| `lease_id` | uuid | References `leases(id)` |
| `modification_date` | date | Modification date |
| `modification_type` | text | Type of modification |
| `description` | text | Description |
| `old_value` | text | Previous value |
| `new_value` | text | New value |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern.

---

### contract_modifications

Contract modification records with remeasurement support.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Modification ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `lease_id` | uuid | References `leases(id)` |
| `modification_date` | date | Effective date |
| `modification_type` | text | Type (e.g., `remeasurement`, `modification`, `amendment`) |
| `reason` | text | Reason for modification |
| `old_monthly_payment`, `new_monthly_payment` | numeric | Payment before/after |
| `old_lease_term`, `new_lease_term` | integer | Term before/after |
| `old_discount_rate`, `new_discount_rate` | numeric | Rate before/after |
| `old_rou_asset`, `new_rou_asset` | numeric | ROU before/after |
| `old_lease_liability`, `new_lease_liability` | numeric | Liability before/after |
| `accounting_treatment` | text | Treatment approach |
| `remeasurement_required` | boolean | Whether remeasurement is needed |
| `notes` | text | Notes |
| `approved_by` | text | Approver |
| `status` | text | `pending`, `approved`, `rejected` |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern.

---

### contract_cancellations

Contract cancellation/termination records.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Cancellation ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `lease_id` | uuid | References `leases(id)` |
| `cancellation_date` | date | Cancellation date |
| `cancellation_reason` | text | Reason |
| `early_termination` | boolean | Whether early termination |
| `termination_penalty` | numeric | Penalty amount |
| `remaining_rou_asset` | numeric | Remaining ROU asset |
| `remaining_lease_liability` | numeric | Remaining liability |
| `gain_loss_amount` | numeric | Gain or loss on termination |
| `final_payment_amount` | numeric | Final settlement payment |
| `settlement_details` | text | Settlement details |
| `approved_by` | text | Approver |
| `status` | text | `pending`, `approved`, `rejected` |
| `derecognition_posted` | boolean | Whether derecognition journal entries were posted |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern.

---

### month_end_documents

Month-end summary documents with posted/unposted status.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Document ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `period` | text | Accounting period (e.g., `2026-09`) |
| `period_label` | text | Display label |
| `lease_count` | integer | Number of leases |
| `transaction_count` | integer | Number of transactions |
| `total_interest` | numeric | Total interest expense |
| `total_depreciation` | numeric | Total depreciation |
| `total_principal` | numeric | Total principal reduction |
| `status` | text | `draft` or `posted` |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern. Update policy allows `posted` status transition.

---

### accounting_periods

Accounting period definitions with open/closed status.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Period ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `period` | text | Period identifier |
| `period_start` | date | Start date |
| `period_end` | date | End date |
| `status` | text | `open` or `closed` |
| `total_debits`, `total_credits` | numeric | Totals |
| `closed_by` | text | User who closed the period |
| `closed_at` | timestamptz | Closure timestamp |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at` | timestamptz | Timestamp |

**RLS**: Standard pattern with ownership-based permissive policies.

---

### branches

Branch/location reference data.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Branch ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `branch_name` | text | Branch name |
| `branch_code` | text | Branch code |
| `address`, `city`, `state`, `country`, `postal_code` | text | Address fields |
| `manager_name` | text | Manager name |
| `contact_email`, `contact_phone` | text | Contact info |
| `is_active` | boolean | Active flag |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern.

---

### fixed_asset_types

Asset type reference data for lease classification.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Type ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `type_name` | text | Type name |
| `type_code` | text | Type code |
| `description` | text | Description |
| `is_active` | boolean | Active flag |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern.

---

### companies

Company entities for grouping leases.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Company ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `company_name` | text | Company name |
| `company_code` | text | Company code |
| `address`, `city`, `state`, `country`, `postal_code` | text | Address fields |
| `tax_id` | text | Tax ID |
| `industry` | text | Industry |
| `is_active` | boolean | Active flag |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern with ownership-based permissive policies.

---

### documents

Uploaded document metadata (files stored in Supabase Storage).

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Document ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `lease_id` | uuid | References `leases(id)` (nullable) |
| `file_name` | text | File name |
| `file_path` | text | Storage path |
| `file_type` | text | MIME type |
| `file_size` | bigint | File size in bytes |
| `category` | text | Document category |
| `description` | text | Description |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern. Storage bucket `documents` has organization-scoped upload/download policies.

---

### subscription_plans

Stripe subscription plan definitions (shared across all organizations).

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Plan ID |
| `plan_key` | text | Plan identifier (`starter`, `professional`, `enterprise`) |
| `plan_name` | text | Display name |
| `max_leases` | integer | Max active leases |
| `price_monthly`, `price_annually` | numeric | Prices in cents |
| `features` | jsonb | Feature list |
| `is_active` | boolean | Active flag |
| `sort_order` | integer | Display order |
| `stripe_price_id_monthly` | text | Stripe price ID (monthly) |
| `stripe_price_id_annually` | text | Stripe price ID (annually) |
| `created_at` | timestamptz | Timestamp |

**RLS**: Enabled. Readable by all authenticated users (no organization filter — shared reference data).

---

### subscriptions

Organization subscription records synced with Stripe.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Subscription ID |
| `user_id` | uuid | Owner (references `auth.users`) |
| `plan_key` | text | References `subscription_plans(plan_key)` |
| `billing_cycle` | text | `monthly` or `annually` |
| `status` | text | `trialing`, `active`, `past_due`, `cancelled` |
| `trial_ends_at` | timestamptz | Trial end date |
| `current_period_start` | timestamptz | Current period start |
| `current_period_end` | timestamptz | Current period end |
| `organization_id` | uuid | References `organizations(id)` |
| `created_at`, `updated_at` | timestamptz | Timestamps |

**RLS**: Standard pattern with tenant isolation.

---

### stripe_customers

Stripe customer records linking auth users to Stripe customers.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Record ID |
| `user_id` | uuid | References `auth.users(id)` |
| `customer_id` | text | Stripe customer ID |
| `created_at`, `updated_at` | timestamptz | Timestamps |
| `deleted_at` | timestamptz | Soft delete timestamp |

**RLS**: Enabled. No organization_id (maps auth users to Stripe customers).

---

### stripe_subscriptions

Stripe subscription records synced via webhook.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Record ID |
| `customer_id` | text | Stripe customer ID |
| `subscription_id` | text | Stripe subscription ID |
| `price_id` | text | Stripe price ID |
| `current_period_start` | timestamptz | Period start |
| `current_period_end` | timestamptz | Period end |
| `cancel_at_period_end` | boolean | Cancel at period end flag |
| `payment_method_brand` | text | Card brand |
| `payment_method_last4` | text | Card last 4 digits |
| `status` | text | Stripe subscription status |
| `created_at`, `updated_at` | timestamptz | Timestamps |
| `deleted_at` | timestamptz | Soft delete timestamp |

**RLS**: Enabled.

---

### stripe_orders

Stripe checkout session order records.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Record ID |
| `checkout_session_id` | text | Stripe checkout session ID |
| `payment_intent_id` | text | Stripe payment intent ID |
| `customer_id` | text | Stripe customer ID |
| `amount_subtotal`, `amount_total` | numeric | Amounts |
| `currency` | text | Currency code |
| `payment_status` | text | `paid`, `unpaid`, `no_payment_required` |
| `status` | text | Checkout session status |
| `created_at`, `updated_at` | timestamptz | Timestamps |
| `deleted_at` | timestamptz | Soft delete timestamp |

**RLS**: Enabled.

---

## Views

### stripe_user_subscriptions

Joins `subscriptions` with `stripe_subscriptions` and `stripe_customers` to provide a unified view of subscription state for the billing page. Uses `INNER JOIN` to avoid duplicate rows.

### stripe_user_orders

Joins `stripe_orders` with `stripe_customers` to associate orders with auth users.

---

## RPC Functions

| Function | Purpose |
|---|---|
| `get_lease_summary_stats` | Returns lease portfolio summary (active count, total ROU, total liability) with company filtering |
| `get_filtered_transactions` | Server-side filtered transaction query with pagination, period/company/asset-type/branch filters |

---

## Indexes

Composite indexes exist on frequently queried columns (e.g., `organization_id + lease_id`, `organization_id + transaction_date`). Foreign-key indexes cover all FK constraints. Indexes on `organization_id`, `user_id`, and foreign-key columns are preserved even if reported as unused by the advisor, because they are critical for RLS policy performance.

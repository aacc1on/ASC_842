# Lease Accountant — ASC 842 Lease Accounting

A multi-tenant web application for managing lease portfolios under ASC 842. Users can create leases, classify them as operating or finance, generate amortization schedules and journal entries, process month-end transactions, manage contract modifications and cancellations, upload documents, and produce financial and compliance reports.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, lucide-react icons
- **Routing**: react-router-dom (URL-based navigation with lazy-loaded routes)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Payments**: Stripe (subscriptions via checkout sessions and webhooks)
- **Testing**: Vitest
- **Linting**: ESLint + TypeScript ESLint

## Project Structure

```
src/
├── App.tsx                    # Root component: auth, routing, subscription banners
├── main.tsx                   # Vite entry point
├── index.css                  # Tailwind directives + global styles
├── components/
│   ├── Auth.tsx               # Sign-in / sign-up / password reset
│   ├── MenuBar.tsx            # Sidebar navigation + company selector
│   ├── Dashboard.tsx          # Lease portfolio overview (/leases)
│   ├── LeaseForm.tsx          # Create / edit lease wizard
│   ├── LeaseList.tsx          # Paginated lease table
│   ├── TransactionsView.tsx   # Transaction journal (/transactions)
│   ├── ModificationsModule.tsx       # Contract modifications + cancellations (/modifications)
│   ├── ContractModificationView.tsx  # Standalone modification viewer
│   ├── DocumentsView.tsx      # Document upload and management (/documents)
│   ├── ReportsView.tsx        # Financial and compliance reports (/reports)
│   ├── BillingView.tsx        # Stripe subscription management (/billing)
│   ├── UserView.tsx           # User profile and admin management (/user)
│   ├── AmortizationView.tsx   # Amortization schedule viewer
│   ├── JournalEntriesView.tsx # Journal entry viewer
│   ├── MonthEndDocumentsView.tsx  # Month-end processing
│   ├── BreakdownPanel.tsx     # Reusable breakdown panel
│   ├── Pagination.tsx         # Reusable pagination control
│   ├── ErrorBoundary.tsx      # Per-view error boundary
│   ├── ToastContext.tsx       # Toast notification provider
│   ├── LandingPage.tsx        # Marketing landing page
│   ├── contract-mods/         # Sub-components for contract modifications
│   ├── dashboard/             # Dashboard stat cards, toolbar, filters, fullscreen table
│   ├── documents/             # Document category cards, table, upload modal
│   ├── lease-form/            # Lease form sections (basic info, payments, costs, classification)
│   ├── modifications/         # Modification tables, modals, calculation helpers
│   ├── reports/               # Report tabs, financial report bodies, compliance sections
│   ├── transactions/          # Transaction tables, filters, modals, summary cards
│   └── user/                  # Profile, management, backup tabs and modals
├── hooks/                     # Custom hooks (all Supabase data access lives here)
│   ├── useCompanies.ts        # Company CRUD + selection
│   ├── useDashboardData.ts    # Lease summary stats + delete
│   ├── useTransactionsData.ts # Transaction loading with server-side filtering
│   ├── useReportsData.ts      # Report data loading
│   ├── useBillingData.ts      # Subscription plans, current subscription, payment history
│   ├── useManagedUsers.ts     # Admin user management CRUD
│   ├── useUserProfile.ts      # Profile loading/saving, password change
│   ├── useLeaseFormData.ts    # Branches, asset types, companies for lease form
│   ├── useLeaseFormState.ts   # Lease form state management
│   ├── useLeaseFormActions.ts # Lease create/update/delete
│   ├── useModificationsData.ts        # Modifications + cancellations loading
│   ├── useModificationForm.ts         # Modification form state
│   ├── useModificationActions.ts      # Modification CRUD
│   ├── useContractModificationsData.ts # Contract mod data loading
│   ├── useContractModForm.ts          # Contract mod form state
│   ├── useContractModActions.ts       # Contract mod CRUD
│   ├── useFinancialReports.ts         # Financial report generation
│   ├── usePeriodSelector.ts           # Period selection (week/month/year/custom)
│   ├── useTransactionFilters.ts       # Transaction filter state + logic
│   ├── useTransactionForm.ts          # Transaction add/edit form state
│   ├── useTransactionSummary.ts       # Transaction summary calculations
│   ├── useTransactionMutations.ts     # Transaction CRUD mutations
│   ├── useWeeklyGroups.ts             # Weekly transaction grouping
│   ├── useMonthEnd.ts                 # Month-end processing logic
│   ├── useBackup.ts                   # Data backup/export
│   └── useSort.ts                     # Sort state management
├── lib/
│   └── supabase.ts            # Supabase client singleton
├── types/
│   └── lease.ts               # Shared TypeScript interfaces (Lease, ContractModification, etc.)
└── utils/                     # Pure calculation functions (unit-tested)
    ├── leaseCalculations.ts   # Present value, amortization schedule, ROU/liability
    ├── leaseClassification.ts # ASC 842 classification criteria
    ├── journalEntries.ts      # Journal entry generation
    ├── currentBalances.ts     # Current balance calculations
    ├── financialReports.ts    # Financial report aggregation
    ├── transactionGenerator.ts # Transaction generation from lease data
    ├── monthEndTransactions.ts # Month-end transaction logic
    ├── exportTransactionsExcel.ts # Excel export (dynamic xlsx import)
    ├── formatting.ts          # Currency/date formatting helpers
    ├── csvExport.ts           # CSV export utility
    ├── errors.ts              # Error message extraction
    └── ...                    # Report utils, period dates, entry types
```

## Running Locally

```bash
npm install      # install dependencies
npm run dev      # start dev server (http://localhost:5173)
```

The dev server starts automatically — no manual command needed in the Bolt environment.

## Environment Variables

The following variables are pre-populated in `.env` and the hosted environment. Do not modify them.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (frontend access) |
| `SUPABASE_URL` | Supabase project URL (edge functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (edge functions only) |
| `SUPABASE_DB_URL` | Postgres connection string |
| `STRIPE_SECRET_KEY` | Stripe API secret (edge functions) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking (no emit) |
| `npm run lint` | ESLint (0 errors / 0 warnings required) |
| `npm run test` | Run Vitest test suite |
| `npm run check` | Run typecheck + lint + test + build in sequence |

## Routing

The app uses `react-router-dom` with `BrowserRouter`. Each main view has its own URL path:

| Path | View |
|---|---|
| `/leases` | Lease portfolio dashboard |
| `/transactions` | Transaction journal |
| `/modifications` | Contract modifications and cancellations |
| `/documents` | Document management |
| `/reports` | Financial and compliance reports |
| `/billing` | Stripe subscription management |
| `/user` | User profile and admin management |
| `/` | Redirects to `/leases` |
| `*` | Redirects to `/leases` |

Browser Back/Forward buttons and bookmarks work. Each route is lazy-loaded with `React.lazy` + `Suspense` (small spinner fallback). The `xlsx` library is dynamically imported only when Excel export is used.

The Stripe checkout flow redirects to `/billing?billing_success=true` or `/billing?billing_cancel=true`, which triggers a success or cancellation message.

## Database Security Model

### Multi-Tenant Organizations

Every user belongs to an organization (stored in `user_profiles.organization_id`). All data tables have an `organization_id` column. A `current_org_id()` function in the `internal` schema resolves the caller's organization from their JWT claims.

### Restrictive Tenant Isolation

Every data table has a **restrictive** `tenant_isolation_*` policy (`FOR ALL`) that enforces `organization_id = internal.current_org_id()`. Restrictive policies are AND-combined with permissive policies — even if a permissive policy grants access, the restrictive policy blocks cross-organization reads or writes.

### Role Guard

User roles (`admin`, `manage`, `view`) are stored in `user_profiles.role`. An `internal.has_data_access()` function returns `true` for `admin` and `manage` roles. Consolidated permissive `SELECT` policies use `internal.has_data_access() OR auth.uid() = user_id` so manage/admin users can see all data in their organization while view-only users see only their own rows.

### Subscription Enforcement

An `internal.org_has_active_subscription()` function checks the organization's subscription status:

- `trialing` with `trial_ends_at > now()` — active
- `active` with `current_period_end IS NULL OR > now()` — active
- `past_due` with `current_period_end > now() - 7 days` — active (7-day grace period)

Restrictive `subscription_required_*` policies block `INSERT`, `UPDATE`, and `DELETE` when the subscription is inactive. Users can still read and export data during an inactive subscription, but cannot create, edit, or delete.

The frontend shows an amber banner when the subscription is inactive and a red "payment failed — update billing within X days" banner during the past_due grace period.

## Edge Functions

All edge functions run on Deno and are deployed via the Supabase MCP tool. Each has CORS headers on every response.

### stripe-checkout (`verify_jwt = true`)

Called from the billing page when a user clicks Subscribe. Receives a Stripe price ID and checkout mode, creates a Stripe checkout session, and returns the checkout URL. The user is redirected to Stripe's hosted checkout page, which redirects back to `/billing?billing_success=true` or `/billing?billing_cancel=true`.

### stripe-webhook (`verify_jwt = false`)

Receives Stripe webhook events (no JWT — verified by Stripe signature). Handles:

- `checkout.session.completed` — records the order, creates/updates subscription
- `customer.subscription.updated` / `customer.subscription.deleted` — syncs subscription status
- `invoice.payment_succeeded` — updates current period end

The webhook updates the `subscriptions`, `stripe_customers`, `stripe_subscriptions`, and `stripe_orders` tables using the service role key.

### recreate-user (`verify_jwt = true`)

Called during the user management flow when an admin creates a new user. Uses the service role key to create a new auth user via `supabaseAdmin.auth.admin.createUser`, then creates the `user_profiles` row.

### admin-update-user-password (`verify_jwt = true`)

Called when an admin changes a managed user's password. Verifies the caller is an admin in the same organization as the target user, enforces a minimum password length of 8 characters, and updates the password using the service role key.

### health (`verify_jwt = false`)
Public, read-only uptime probe for an external monitor:

    GET https://eieariefpfzqalskgubn.supabase.co/functions/v1/health

Returns `{ "status": "ok" | "degraded", "db": "ok" | "error", "version", "time" }` (HTTP 200 when healthy, 503 otherwise). It exposes no data or configuration and is limited to 60 requests per minute per IP.

### error-alert (`verify_jwt = true`)
Delivers pending error alerts. A database trigger on `error_logs` raises an alert when more than N errors (default 10, editable in Platform Admin > Error alerts) are logged within 15 minutes, or on any error tagged `save_lease`, `month_end` or `stripe_webhook`. At most one alert is raised per 30 minutes; later qualifying errors are counted as "suppressed" on the latest alert. Alerts are emailed through Resend (secret **`RESEND_API_KEY`**) from `alerts@ms-consult.us` to **`ALERT_EMAIL_TO`** (default `minas@ms-consult.us`), at most one email per alert type (reason + source) per 15 minutes, tracked in `internal.error_alert_email_throttle`. Emails contain only type, severity, UTC time, source, a scrubbed one-line message, a masked organization id, the occurrence count and a link to Platform Admin. If the optional **`ALERT_WEBHOOK_URL`** (HTTPS) is set, alerts are also POSTed there as `{ text, alert }`. With neither configured, alerts stay in Platform Admin with status "No alert destination set". Body `{ "action": "test" }` sends a test alert (platform owner only; at most one per minute).

### Rate limiting
`_shared/rateLimit.ts` counts requests in `internal.rate_limits` (fixed windows, per signed-in user, or per IP for unauthenticated calls) and returns HTTP 429 with `Retry-After` and a plain message the app displays.

| Function | Limit |
|---|---|
| recreate-user, remove-user, admin-update-user-password, platform-admin-edit-user, platform-admin-delete-user | 10 per 10 minutes |
| export-backup | 5 per hour |
| stripe-checkout | 20 per hour |
| reopen-month-end | 10 per hour |
| error-alert | 30 per hour |
| health | 60 per minute per IP |
| stripe-webhook | not limited (Stripe signature verified) |

If the counter is unavailable, requests are allowed (fail-open) so an outage of the limiter cannot lock admins out.

### Launch checklist
1. **Leave the `ALLOW_BOLT_PREVIEW` secret unset (or `false`) and set `APP_ORIGINS` to your site origin(s).** Only when the secret is exactly `true` do edge functions accept browser calls from any `https://*.webcontainer-api.io` Bolt preview (development/staging only). See `docs/DEPLOY.md`.
2. Set `RESEND_API_KEY` so error alerts are emailed (optionally `ALERT_EMAIL_TO` and `ALERT_WEBHOOK_URL`), then press "Send test alert" in Platform Admin.
3. Point the uptime monitor at the health URL above.

### Stripe Webhook Flow

```
User clicks Subscribe
  → Frontend calls stripe-checkout edge function
  → Stripe checkout session created, user redirected to Stripe
  → User completes payment on Stripe
  → Stripe redirects to /billing?billing_success=true
  → Stripe sends webhook to stripe-webhook edge function
  → Webhook updates subscriptions + stripe_* tables
  → Frontend shows success message and reloads subscription status
```

## ASC 842 Calculation Approach

The app implements two lease classifications under ASC 842:

### Operating Leases

- **ROU asset and lease liability** are measured at the present value of remaining lease payments, plus initial direct costs minus lease incentives.
- **Single straight-line lease cost**: The total lease cost (total payments + initial direct costs - incentives) is divided evenly over the lease term. Each period, the same amount is recognized as lease expense.
- **Interest expense** is calculated on the lease liability using the effective interest method. The difference between the straight-line cost and interest expense reduces the ROU asset (amortization).
- Journal entries: Debit lease expense, Credit lease liability (interest accretion); Debit lease liability, Credit cash (payment).

### Finance Leases

- **ROU asset and lease liability** are measured at the present value of remaining lease payments, plus initial direct costs minus incentives.
- **Interest expense**: Calculated each period on the beginning lease liability balance using the incremental borrowing rate (effective interest method).
- **ROU amortization**: Straight-line depreciation of the ROU asset over the lease term.
- Journal entries: Debit interest expense, Credit lease liability; Debit depreciation expense, Credit accumulated depreciation; Debit lease liability, Credit cash (payment).

### Classification Criteria

Leases are classified as finance if any of the following are true:
1. Ownership transfers to the lessee at end of term
2. Purchase option exists and is reasonably certain to be exercised
3. Lease term is for the major part of the asset's economic life
4. Present value of payments is substantially equal to the asset's fair value
5. The asset is specialized

If none are met, the lease is classified as operating. The app supports both automatic classification (based on criteria inputs) and manual override.

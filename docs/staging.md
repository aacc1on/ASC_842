# Staging environment

Staging is a **separate Supabase project** used to try changes before they reach customers.

| | Project ref | Region |
|---|---|---|
| Staging | `kiakzaihvghxgkvwqufe` | us-west-2 |
| Production (never targeted by staging tooling) | `eieariefpfzqalskgubn` | — |

**Rule: staging holds demo data only. Never copy, import or restore real customer data into staging**
(no production backups, no CSV exports, no "just one customer to reproduce a bug").

## How staging is updated

The GitHub Actions workflow `.github/workflows/staging.yml` does all staging changes:

- **Automatic update** – every push to `main` that changes anything under `supabase/` applies new
  migrations to staging (`supabase db push --linked --include-all`) and deploys all edge functions.
- **RESET (manual)** – wipes staging completely and rebuilds it:
  1. empties and deletes every storage bucket (files included),
  2. drops leftover app schemas from older app versions,
  3. `supabase db reset --linked --no-seed` – drops everything user-created and re-applies every file in
     `supabase/migrations` in order,
  4. deletes **all** sign-ins (`auth.users`),
  5. loads the demo data from `supabase/seed-staging.sql`,
  6. signs in as the demo user and generates every demo lease's amortization schedule and journal entries
     (`scripts/staging/generate-demo-schedules.mjs`, see Demo data),
  7. verifies them (`scripts/staging/verify-demo-data.sql`): every demo lease has schedule rows,
     `leases_missing_amortization` has no demo rows, and journal debits equal credits per lease and in total,
  8. deploys all edge functions.

Runs never overlap (concurrency group `staging`). Before any command runs, a guard step fails the job if the
staging ref was changed, equals the production ref, or if the production ref appears anywhere in the
workflow commands or under `supabase/`. After linking, every step re-checks that the linked project is staging.

If the GitHub secrets below are missing, the workflow prints a notice and finishes green without doing anything.

## GitHub secrets (Settings → Secrets and variables → Actions → New repository secret)

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | A personal access token from supabase.com → Account → Access Tokens. |
| `STAGING_DB_PASSWORD` | The database password of the **staging** project (Project Settings → Database). |

Nothing else is needed. Never put production passwords or keys into GitHub.

## Running the RESET

1. GitHub → **Actions** → **Staging** → **Run workflow** (branch `main`).
2. In **confirm**, type exactly `RESET-STAGING` and start the run.

Any other value fails without changing anything; an empty value runs a normal update.
**Run a RESET first**: staging currently holds an older app version whose migration history does not match,
so a normal update would be refused until staging has been rebuilt once.

## When a run fails

Every failure appears as a red annotation on the run page and in the job summary, with the last 15 output lines
(passwords, tokens and keys are replaced by `***`). The Supabase CLI version is pinned in the workflow
(`SUPABASE_CLI_VERSION`) together with the sha256 of `supabase_<version>_linux_amd64.tar.gz`
(`SUPABASE_CLI_SHA256`, copied from the release's `checksums.txt`). The download must match both the pinned hash
and the published `checksums.txt`; a missing list, missing entry or mismatch stops the run before anything changes.
Raise the version deliberately and update the hash in the same change.

| Annotation | What to do |
|---|---|
| Access token rejected | Create a new token (Account → Access Tokens) and replace `SUPABASE_ACCESS_TOKEN`. |
| Staging project not visible | The token belongs to an account that cannot see `kiakzaihvghxgkvwqufe`. Create it from the owning account. |
| Staging project not running | Staging is paused or restoring. Restore it in the dashboard and re-run. |
| Wrong database password | Reset the password in Supabase → Lease (staging) → Database settings and replace `STAGING_DB_PASSWORD`. |
| Staging database unreachable | The database could not be reached (paused, restoring, maintenance). Check the dashboard, re-run. |
| Not linked to staging | The CLI linked somewhere else. Nothing further ran; report it, do not retry blindly. |
| CLI checksum unavailable / not listed / mismatch | The CLI download could not be verified. Check the pinned version and hash; never remove the check. |
| Demo schedule generation failed / Demo data verification failed | The annotation names the lease and problem (no schedule, monitor rows, unbalanced journal). Fix the cause and re-run the RESET. |
| Link / Migrations / Database reset / Storage wipe / Schema cleanup / Demo data / Edge function deploy failed | Read the output lines in the annotation; they contain the CLI or API error. |

A failure before the RESET steps (secrets, token check, link) never changes staging.

## Demo data

`supabase/seed-staging.sql` creates:

- sign-in `demo@example.com`, password `StagingDemo-2026!` (staging only – this password is public in the
  repository, so never reuse it anywhere else),
- organization and company "Northwind Demo Holdings" on an active Professional plan,
- 8 leases with realistic terms: 5 operating (HQ office, retail store, distribution centre, copier fleet,
  satellite office) and 3 finance (delivery vans, forklifts with a purchase option, POS/server hardware).

It runs automatically after a RESET and is safe to re-run (it skips itself if the demo sign-in exists).

The seed holds no schedule numbers. Right after it, the RESET runs `scripts/staging/generate-demo-schedules.mjs`,
which signs in as the demo user and, for each demo lease, does exactly what saving the lease in the app does:
the app's own TypeScript calculation code (`buildAmortizationRows`, `calculateSubmittedLeaseMetrics`, …, loaded
through esbuild by `scripts/staging/load-demo-schedules.mjs`) computes the schedule, liability and ROU asset and
`save_lease` stores them; then the Journal tab's `buildLeaseJournalEntries` builds the entries and
`refresh_lease_journal_entries` saves them. Liability and ROU values in the seed are therefore replaced by the
app's figures.

CI checks on every push that all migrations rebuild an empty database, that this seed loads, and that the same
generator produces schedules and balanced journal entries for every demo lease with no
`leases_missing_amortization` rows (`node scripts/check-migrations-empty-db.mjs --seed supabase/seed-staging.sql`).

**Two organizations after a RESET is expected.** Besides the demo organization, an early migration
(`…_multi_tenant_backfill`) always creates an empty "Default Organization" (production's platform-owner
organization). On staging it has no users, leases or sign-ins. It cannot be deleted because the append-only
audit log references it, and removing it would mean bypassing that protection, so it is left in place.

## Edge function secrets on staging

Set these in the staging project (Edge Functions → Secrets). **Never copy values from production.**

| Secret | Staging value |
|---|---|
| `ALLOW_BOLT_PREVIEW` | `true` |
| `APP_ORIGINS` | Comma-separated origins of the staging app / preview (e.g. the duplicated Bolt project's URL). |
| `STRIPE_SECRET_KEY` | A Stripe **test** key (`sk_test_…`) – never a live key. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of a Stripe **test-mode** webhook pointing at `https://kiakzaihvghxgkvwqufe.supabase.co/functions/v1/stripe-webhook`. |
| `ALERT_WEBHOOK_URL` | **Do not set** on staging (keeps staging errors out of production alerting). |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically.

## Pointing an app at staging

Duplicate the Bolt project (or use a preview) and set:

```
VITE_SUPABASE_URL=https://kiakzaihvghxgkvwqufe.supabase.co
VITE_SUPABASE_ANON_KEY=<staging anon key from staging Project Settings → API>
```

Do not change the original project's `.env`; it must keep pointing at production. Add the staging app's URL to
`APP_ORIGINS` and to staging Authentication → URL Configuration.

## Migration notes for a fresh database

- `supabase/migrations` contains exactly the migrations applied to production, in order.
- `supabase/migrations_never_applied/` holds 26 older files that production never ran (their content reached
  production through later combined migrations). They would break a fresh rebuild, so they are kept out of
  the migrations folder. Do not move them back.
- Two migrations that only made sense for production rows are guarded so they do nothing on an empty database
  and behave exactly as before on production:
  - `20261008003935_secure_platform_owner_and_trial_admin_approval.sql` – registers the platform owner only if
    that sign-in exists.
  - `20261008231127_…_fix_org_plan_key_expired_and_restore_platform_owner.sql.sql` – the data-fix block skips
    itself when the production organization does not exist.
- `scripts/check-migrations.mjs` rejects duplicate version timestamps and hard-coded UUIDs in new migrations.

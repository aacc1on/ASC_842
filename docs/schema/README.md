# Schema baseline

`baseline_2026-10-12.sql` is a snapshot of the live `public` and `internal` schemas as of 2026-10-12. It covers:
- functions
- tables
- constraints
- indexes
- triggers
- RLS settings and policies
- table and function grants

It was generated from the system catalogs. It contains no data.

## Building a new environment (e.g. staging)

1. Create a new Supabase project. The `auth`, `storage` and extension schemas come from Supabase itself and are not in the baseline.
2. Run the baseline as one script in the SQL editor or with `psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f docs/schema/baseline_2026-10-12.sql`. The `-1` flag runs it as a single transaction.
   - The file starts with `SET check_function_bodies = off`, so functions can be created before the tables they reference.
   - The order is: functions, tables, constraints, indexes, row-type functions, triggers, RLS, policies, grants.
3. Apply every migration in `supabase/migrations/` dated **after** `20261012194847_round_c_database_cleanup.sql`. Earlier ones are already in the baseline.
4. Seed reference data (plans, a first organization and admin user) through the app or a separate seed script. Business data is never copied from production.
5. Deploy the edge functions and set their secrets on the new project.

## Rules for new migrations

`scripts/check-migrations.mjs` runs in CI. Every migration file that is not in its frozen list of existing files must:
- end in `.sql`, not `.sql.sql`;
- not change other functions by text rewriting (`regexp_replace` or `pg_get_functiondef`). Re-create the function in full with `CREATE OR REPLACE FUNCTION` instead.

Existing migration files are never edited, renamed or moved.

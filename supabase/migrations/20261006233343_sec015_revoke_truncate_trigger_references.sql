/*
# SEC-015: Revoke TRUNCATE, TRIGGER and REFERENCES from authenticated and anon

1. Problem
   The `authenticated` and `anon` roles still held TRUNCATE, TRIGGER and
   REFERENCES privileges on some public tables/views. These are not needed by
   the application (which only uses SELECT/INSERT/UPDATE/DELETE through the
   PostgREST API) and represent unnecessary privilege surface.

2. Changes
   - Revoke TRUNCATE, TRIGGER and REFERENCES on ALL existing public tables and
     views from `authenticated` and `anon`.
   - Set ALTER DEFAULT PRIVILEGES so future tables do not get them.

3. Security
   - Reduces the privilege surface to only what the app needs (CRUD via RLS).
   - Ensures new tables created by future migrations inherit the same minimal
     privilege set.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type IN ('BASE TABLE', 'VIEW')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I.%I FROM authenticated', r.table_schema, r.table_name);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I.%I FROM anon', r.table_schema, r.table_name);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon;

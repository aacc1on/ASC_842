/*
# Single-use diagnostic passes for server-side checks

1. New Tables
- `internal.ops_nonces` (not exposed to the website)
  - `nonce_hash` (text, primary key) - SHA-256 of a one-time pass, never the pass itself
  - `purpose` (text) - which check the pass unlocks (e.g. 'portal-diagnose')
  - `expires_at` (timestamptz) - pass stops working after this time
2. New Functions
- `public.consume_ops_nonce(p_nonce text, p_purpose text) returns boolean`
  Deletes the matching, unexpired pass and returns true exactly once.
3. Security
- RLS enabled on the table with no policies (deny by default).
- The function is SECURITY DEFINER and executable ONLY by service_role (edge functions);
  anon and authenticated cannot call it.
4. Notes
- Passes are inserted by operators directly in the database; they are single-use and short-lived.
*/

CREATE TABLE IF NOT EXISTS internal.ops_nonces (
  nonce_hash text PRIMARY KEY,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE internal.ops_nonces ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_ops_nonce(p_nonce text, p_purpose text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH used AS (
    DELETE FROM internal.ops_nonces
    WHERE nonce_hash = encode(sha256(convert_to(p_nonce, 'UTF8')), 'hex')
      AND purpose = p_purpose
      AND expires_at > now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM used);
$$;

REVOKE ALL ON FUNCTION public.consume_ops_nonce(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ops_nonce(text, text) TO service_role;

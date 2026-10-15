/*
# Legal documents and append-only acceptance records

Records which version of the Terms of Service and Privacy Policy each user agreed to and when.
Server time is always used, so a client can never backdate an acceptance.

1. New tables
- `legal_documents`: the published versions of each legal document.
  - `doc` (text, 'terms' or 'privacy'), `version` (text), `effective_date` (date), `is_current` (bool), `created_at`.
  - Primary key (doc, version). A partial unique index allows only one current version per doc.
  - Seeded with terms and privacy version 2026-10-13, both current.
- `legal_acceptances`: an append-only log of every acceptance.
  - `id`, `user_id` (references auth.users, cascades on user deletion), `organization_id` (nullable),
    `doc`, `version` (FK to legal_documents), `accepted_at` (server time), `source`
    ('signup', 'reaccept', 'invite'), `user_agent` (nullable, truncated to 512 chars).
  - Unique (user_id, doc, version) so acceptances are idempotent.

2. New functions
- `accept_legal_documents(p_terms_version, p_privacy_version, p_source, p_user_agent)`: SECURITY DEFINER.
  Records acceptance for the signed-in user. Rejects versions that are not current. Idempotent.
- `my_legal_status()`: tells the signed-in user whether they have accepted the current versions.
- `get_users_legal_acceptance()`: platform admin only; latest accepted terms version + date per user.
- `internal.record_signup_legal_acceptance()`: AFTER INSERT trigger on auth.users. Records the signup
  acceptance only when the sign-up metadata says terms_accepted=true and names the current versions.
- `internal.prevent_legal_acceptance_mutation()`: rejects UPDATE and DELETE on legal_acceptances,
  except the cascade that runs when the user account itself is deleted.

3. Security
- RLS enabled on both tables.
- legal_documents: readable by anon + authenticated; only the platform admin may insert or update. No deletes.
- legal_acceptances: users read their own rows, org admins read their org's rows, platform admin reads all.
  No INSERT/UPDATE/DELETE privileges for anon or authenticated; writes go through the functions above.

4. Notes
- Publishing a new version: insert the new legal_documents rows and switch is_current in a new migration
  (see docs/legal.md). Users who accepted an older version are asked to accept again on next sign-in.
*/

CREATE TABLE IF NOT EXISTS public.legal_documents (
  doc text NOT NULL CHECK (doc IN ('terms', 'privacy')),
  version text NOT NULL,
  effective_date date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_current_per_doc
  ON public.legal_documents (doc) WHERE is_current;

INSERT INTO public.legal_documents (doc, version, effective_date, is_current) VALUES
  ('terms', '2026-10-13', DATE '2026-10-13', true),
  ('privacy', '2026-10-13', DATE '2026-10-13', true)
ON CONFLICT (doc, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NULL,
  doc text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('signup', 'reaccept', 'invite')),
  user_agent text NULL,
  CONSTRAINT legal_acceptances_document_fkey FOREIGN KEY (doc, version) REFERENCES public.legal_documents (doc, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_user_doc_version
  ON public.legal_acceptances (user_id, doc, version);
CREATE INDEX IF NOT EXISTS legal_acceptances_organization_id ON public.legal_acceptances (organization_id);

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.legal_documents FROM anon, authenticated;
GRANT SELECT ON public.legal_documents TO anon, authenticated;
GRANT INSERT, UPDATE ON public.legal_documents TO authenticated;

REVOKE ALL ON public.legal_acceptances FROM anon, authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;

DROP POLICY IF EXISTS "Anyone can read legal documents" ON public.legal_documents;
CREATE POLICY "Anyone can read legal documents" ON public.legal_documents FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Platform admin can add legal documents" ON public.legal_documents;
CREATE POLICY "Platform admin can add legal documents" ON public.legal_documents FOR INSERT
  TO authenticated WITH CHECK (internal.is_platform_admin());

DROP POLICY IF EXISTS "Platform admin can update legal documents" ON public.legal_documents;
CREATE POLICY "Platform admin can update legal documents" ON public.legal_documents FOR UPDATE
  TO authenticated USING (internal.is_platform_admin()) WITH CHECK (internal.is_platform_admin());

DROP POLICY IF EXISTS "Users read own legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Users read own legal acceptances" ON public.legal_acceptances FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org admins read org legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Org admins read org legal acceptances" ON public.legal_acceptances FOR SELECT
  TO authenticated USING (organization_id IS NOT NULL AND organization_id = internal.current_org_id() AND internal.is_admin());

DROP POLICY IF EXISTS "Platform admin reads all legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Platform admin reads all legal acceptances" ON public.legal_acceptances FOR SELECT
  TO authenticated USING (internal.is_platform_admin());

CREATE OR REPLACE FUNCTION internal.prevent_legal_acceptance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Legal acceptance records are append-only.' USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS prevent_legal_acceptance_mutation ON public.legal_acceptances;
CREATE TRIGGER prevent_legal_acceptance_mutation
  BEFORE UPDATE OR DELETE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_legal_acceptance_mutation();

CREATE OR REPLACE FUNCTION public.my_legal_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH cur AS (
    SELECT
      (SELECT version FROM public.legal_documents WHERE doc = 'terms' AND is_current) AS terms_version,
      (SELECT version FROM public.legal_documents WHERE doc = 'privacy' AND is_current) AS privacy_version
  ), mine AS (
    SELECT
      EXISTS (SELECT 1 FROM public.legal_acceptances a, cur WHERE a.user_id = auth.uid() AND a.doc = 'terms' AND a.version = cur.terms_version) AS terms_ok,
      EXISTS (SELECT 1 FROM public.legal_acceptances a, cur WHERE a.user_id = auth.uid() AND a.doc = 'privacy' AND a.version = cur.privacy_version) AS privacy_ok,
      EXISTS (SELECT 1 FROM public.legal_acceptances a WHERE a.user_id = auth.uid()) AS any_prior
  )
  SELECT jsonb_build_object(
    'accepted', mine.terms_ok AND mine.privacy_ok,
    'terms_accepted', mine.terms_ok,
    'privacy_accepted', mine.privacy_ok,
    'has_prior_acceptance', mine.any_prior,
    'terms_version', cur.terms_version,
    'privacy_version', cur.privacy_version
  )
  FROM cur, mine
$$;

CREATE OR REPLACE FUNCTION public.accept_legal_documents(
  p_terms_version text,
  p_privacy_version text,
  p_source text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_agent text := left(p_user_agent, 512);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept the terms.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('reaccept', 'invite') THEN
    RAISE EXCEPTION 'Invalid acceptance source.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc = 'terms' AND version = p_terms_version AND is_current)
     OR NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc = 'privacy' AND version = p_privacy_version AND is_current) THEN
    RAISE EXCEPTION 'These terms have been updated. Please reload the page and review the latest version.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT organization_id INTO v_org FROM public.user_profiles WHERE user_id = v_uid;

  INSERT INTO public.legal_acceptances (user_id, organization_id, doc, version, source, user_agent)
  VALUES (v_uid, v_org, 'terms', p_terms_version, p_source, v_agent),
         (v_uid, v_org, 'privacy', p_privacy_version, p_source, v_agent)
  ON CONFLICT (user_id, doc, version) DO NOTHING;

  RETURN public.my_legal_status();
END;
$$;

CREATE OR REPLACE FUNCTION internal.record_signup_legal_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_org uuid;
BEGIN
  IF COALESCE(v_meta->>'terms_accepted', '') <> 'true' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc = 'terms' AND version = v_meta->>'terms_version' AND is_current)
     OR NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc = 'privacy' AND version = v_meta->>'privacy_version' AND is_current) THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org FROM public.user_profiles WHERE user_id = NEW.id;

  INSERT INTO public.legal_acceptances (user_id, organization_id, doc, version, source)
  VALUES (NEW.id, v_org, 'terms', v_meta->>'terms_version', 'signup'),
         (NEW.id, v_org, 'privacy', v_meta->>'privacy_version', 'signup')
  ON CONFLICT (user_id, doc, version) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Named to sort after on_auth_user_created so the user's profile (and organization) already exists.
DROP TRIGGER IF EXISTS on_auth_user_legal_acceptance ON auth.users;
CREATE TRIGGER on_auth_user_legal_acceptance
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION internal.record_signup_legal_acceptance();

CREATE OR REPLACE FUNCTION public.get_users_legal_acceptance()
RETURNS TABLE (user_id uuid, terms_version text, terms_accepted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT internal.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (a.user_id) a.user_id, a.version, a.accepted_at
  FROM public.legal_acceptances a
  WHERE a.doc = 'terms'
  ORDER BY a.user_id, a.accepted_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.my_legal_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_legal_documents(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_users_legal_acceptance() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION internal.record_signup_legal_acceptance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.prevent_legal_acceptance_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_legal_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_legal_documents(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_legal_acceptance() TO authenticated;

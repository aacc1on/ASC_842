/*
# Publish Terms of Service and Privacy Policy version 2026-10-14

1. Data
  - Inserts legal_documents rows ('terms','2026-10-14') and ('privacy','2026-10-14'), effective 2026-10-14.
  - Makes the 2026-10-14 rows current and the 2026-10-13 rows not current.
  - The 2026-10-13 rows are kept because existing acceptances reference them.

2. Effect
  - my_legal_status() now reports users who only accepted 2026-10-13 as not accepted, so they are asked
    to accept 2026-10-14 at their next sign-in. New sign-ups record 2026-10-14.

3. Notes
  1. Idempotent: inserts use ON CONFLICT DO NOTHING; the current flag is cleared before being set so the
     one-current-per-doc unique index is never violated.
*/

INSERT INTO public.legal_documents (doc, version, effective_date, is_current) VALUES
  ('terms', '2026-10-14', DATE '2026-10-14', false),
  ('privacy', '2026-10-14', DATE '2026-10-14', false)
ON CONFLICT (doc, version) DO NOTHING;

UPDATE public.legal_documents
SET is_current = false
WHERE doc IN ('terms', 'privacy') AND version <> '2026-10-14' AND is_current;

UPDATE public.legal_documents
SET is_current = true
WHERE doc IN ('terms', 'privacy') AND version = '2026-10-14' AND NOT is_current;

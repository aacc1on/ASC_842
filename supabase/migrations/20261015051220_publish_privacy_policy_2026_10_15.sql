/*
# Publish Privacy Policy version 2026-10-15 (Terms unchanged at 2026-10-14)

1. Data
  - Inserts legal_documents row ('privacy','2026-10-15'), effective 2026-10-15.
  - Makes privacy 2026-10-15 current and privacy 2026-10-14 not current.
  - All earlier privacy rows are kept because existing acceptances reference them.
  - Terms rows are not touched; terms 2026-10-14 stays current.

2. Reason
  - Sign-in and service emails are now sent through Resend (custom SMTP in Supabase Auth), so the
    subprocessor list names Resend.

3. Effect
  - my_legal_status() reports terms_accepted = true and privacy_accepted = false for users who accepted
    2026-10-14, so they are asked to accept only the updated Privacy Policy at their next sign-in.
  - accept_legal_documents() and the sign-up trigger already validate each document against its own
    current version, so terms 2026-10-14 + privacy 2026-10-15 is accepted; re-recording terms is a no-op.

4. Notes
  1. Idempotent: the insert uses ON CONFLICT DO NOTHING; the current flag is cleared before being set so the
     one-current-per-doc unique index is never violated.
*/

INSERT INTO public.legal_documents (doc, version, effective_date, is_current)
VALUES ('privacy', '2026-10-15', DATE '2026-10-15', false)
ON CONFLICT (doc, version) DO NOTHING;

UPDATE public.legal_documents
SET is_current = false
WHERE doc = 'privacy' AND version <> '2026-10-15' AND is_current;

UPDATE public.legal_documents
SET is_current = true
WHERE doc = 'privacy' AND version = '2026-10-15' AND NOT is_current;

# Legal documents: publishing a new version

The Terms of Service and Privacy Policy are shown at `/terms` and `/privacy`. They are rendered from
`src/legal/terms.md` and `src/legal/privacy.md` by a safe markdown renderer (headings, lists, bold, tables;
raw HTML is never rendered). Table rows may be separated by blank lines and may omit the leading `|`; a line
ending in two spaces is a hard line break (used for the contact blocks). Every user must accept the current version of both documents before using the app.

## Where acceptance is recorded

- `public.legal_documents`: one row per published version; exactly one `is_current` row per doc.
- `public.legal_acceptances`: append-only log (user, org, doc, version, server time, source, user agent).
  Rows cannot be updated or deleted, except automatically when the user account is deleted.
- Sign-up: the form sends `terms_accepted`, `terms_version`, `privacy_version` in the sign-up metadata, and the
  `on_auth_user_legal_acceptance` trigger records them with source `signup` if they match the current versions.
- Everyone else (invited users, the platform owner, users after a new version) sees a blocking screen that calls
  `accept_legal_documents(...)` with source `invite` (never accepted before) or `reaccept`.

## Publishing a new version

1. **Replace the text.** Paste the approved text into `src/legal/terms.md` and/or `src/legal/privacy.md`.
2. **Bump the version.** Update `TERMS_VERSION` and/or `PRIVACY_VERSION` in `src/legal/versions.ts`
   (use the publication date, `YYYY-MM-DD`).
3. **Add a migration** that registers the new version and makes it current. Clear the old current row first,
   because only one current row per doc is allowed:

   ```sql
   UPDATE public.legal_documents SET is_current = false WHERE doc = 'terms' AND is_current AND version <> '2027-01-15';
   INSERT INTO public.legal_documents (doc, version, effective_date, is_current)
   VALUES ('terms', '2027-01-15', DATE '2027-01-15', true)
   ON CONFLICT (doc, version) DO UPDATE SET is_current = true;
   ```

   Repeat for `privacy` if it changed. If only one document changed, keep the other's version unchanged in
   `versions.ts`.
4. **Deploy the app and the migration together.** If the app's versions don't match the database's current
   versions, acceptance is rejected with "These terms have been updated. Please reload the page…".

After publishing, every user is asked to accept again on their next sign-in. Old acceptance rows are kept.
The two documents are versioned independently. If only one changed, users who already accepted the other's
current version see a screen that names only the updated document (e.g. "We updated our Privacy Policy");
re-recording the unchanged document is a no-op.

## Version history

| Version | Effective | Notes |
| --- | --- | --- |
| 2026-10-13 | 2026-10-13 | Placeholder drafts (pending legal review). Kept for existing acceptance records. |
| 2026-10-14 | 2026-10-14 | Final counsel-approved Terms and Privacy Policy (migration `publish_legal_documents_2026_10_14`). |
| 2026-10-15 (Privacy only) | 2026-10-15 | Subprocessor list updated — Resend for authentication emails (migration `publish_privacy_policy_2026_10_15`). Terms stay at 2026-10-14. |

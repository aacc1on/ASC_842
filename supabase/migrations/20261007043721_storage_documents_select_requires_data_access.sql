/*
  F3: Align reads of the `documents` bucket with the documents table rule.

  Previously any organisation member could list and download every member's
  file, while public.documents only exposes rows to internal.has_data_access()
  (admin/manage) or to the row's own owner. Reading one's own folder stays
  unconditional so nobody loses access to their own uploads.
*/

DROP POLICY IF EXISTS "Org members can view documents in storage" ON storage.objects;

CREATE POLICY "Org members can view documents in storage"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(objects.name))[1] = (SELECT auth.uid())::text
    OR (
      internal.has_data_access()
      AND EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = ((storage.foldername(objects.name))[1])::uuid
          AND user_profiles.organization_id = (SELECT internal.current_org_id())
      )
    )
  )
);
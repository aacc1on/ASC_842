/*
  F4: Require manage/admin to upload into the `documents` bucket.

  The documents table INSERT policy already requires
  internal.is_manage_or_admin(), so a read-only user could only ever create
  orphaned objects. Folder ownership (first path segment = auth.uid()) is kept.
*/

DROP POLICY IF EXISTS "Org members can upload documents to storage" ON storage.objects;

CREATE POLICY "Org members can upload documents to storage"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND internal.is_manage_or_admin()
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = (SELECT auth.uid())
      AND user_profiles.organization_id = (SELECT internal.current_org_id())
  )
);
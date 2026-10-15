/*
  F2: Restrict overwriting of objects in the `documents` bucket to manage/admin.

  The previous policy let any organisation member (including the read-only
  `view` role) replace the content of another member's file via an upsert,
  leaving the documents metadata row untouched. The matching table UPDATE
  policy already requires internal.is_manage_or_admin().
*/

DROP POLICY IF EXISTS "Org members can update documents in storage" ON storage.objects;

CREATE POLICY "Org members can update documents in storage"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'documents'
  AND internal.is_manage_or_admin()
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = ((storage.foldername(objects.name))[1])::uuid
      AND user_profiles.organization_id = (SELECT internal.current_org_id())
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND internal.is_manage_or_admin()
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = ((storage.foldername(objects.name))[1])::uuid
      AND user_profiles.organization_id = (SELECT internal.current_org_id())
  )
);
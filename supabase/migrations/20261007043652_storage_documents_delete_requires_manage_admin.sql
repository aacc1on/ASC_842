/*
  F1: Restrict deletion of objects in the `documents` bucket to manage/admin.

  The previous policy allowed ANY member of the organisation (including the
  read-only `view` role) to delete any other member's file, while the
  public.documents table requires internal.is_manage_or_admin() to delete the
  matching row. This aligns storage with the table.
*/

DROP POLICY IF EXISTS "Org members can delete documents in storage" ON storage.objects;

CREATE POLICY "Org members can delete documents in storage"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND internal.is_manage_or_admin()
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = ((storage.foldername(objects.name))[1])::uuid
      AND user_profiles.organization_id = (SELECT internal.current_org_id())
  )
);
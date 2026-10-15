/*
# Multi-tenant: org-scoped storage policies for documents bucket

## What this does
Replaces the existing per-user storage policies on storage.objects for the 'documents'
bucket with org-scoped policies. The upload path format is `{user_id}/{filename}`,
so the first path folder is the uploading user's auth.uid().

The new policies allow read/write/delete only if the first folder (the user_id)
belongs to a user in the same organization as the caller.

## How it works
- storage.foldername(name)[1] gives the first path segment = the user who uploaded
- We check that this user_id exists in user_profiles with the same organization_id
  as the caller (via internal.current_org_id())
- This lets any member of the same org access documents uploaded by their colleagues
*/

-- Drop old per-user policies on storage.objects for documents bucket
DROP POLICY IF EXISTS "Users can view own documents in storage" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own documents to storage" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own documents in storage" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents in storage" ON storage.objects;

-- New org-scoped policies
CREATE POLICY "Org members can view documents in storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = (storage.foldername(name))[1]::uuid
      AND organization_id = (SELECT internal.current_org_id())
    )
  );

CREATE POLICY "Org members can upload documents to storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = auth.uid()
      AND organization_id = (SELECT internal.current_org_id())
    )
  );

CREATE POLICY "Org members can update documents in storage"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = (storage.foldername(name))[1]::uuid
      AND organization_id = (SELECT internal.current_org_id())
    )
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = (storage.foldername(name))[1]::uuid
      AND organization_id = (SELECT internal.current_org_id())
    )
  );

CREATE POLICY "Org members can delete documents in storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = (storage.foldername(name))[1]::uuid
      AND organization_id = (SELECT internal.current_org_id())
    )
  );

/*
  # Create Documents Storage Bucket

  1. Storage
    - Creates the `documents` storage bucket if it does not already exist
    - Bucket is private (not publicly accessible)
    - Sets a 50MB file size limit per upload

  2. Security - Storage RLS Policies
    - Authenticated users can SELECT objects only in their own user-id folder prefix
    - Authenticated users can INSERT objects only in their own user-id folder prefix
    - Authenticated users can UPDATE objects only in their own user-id folder prefix
    - Authenticated users can DELETE objects only in their own user-id folder prefix

  3. Notes
    1. Object paths are expected to start with `{auth.uid()}/...` so folder-level
       ownership checks can be used against the first path segment.
    2. RLS is already enabled by default on the `storage.objects` table by Supabase.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('documents', 'documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can view own documents in storage'
  ) THEN
    CREATE POLICY "Users can view own documents in storage"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can upload own documents to storage'
  ) THEN
    CREATE POLICY "Users can upload own documents to storage"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can update own documents in storage'
  ) THEN
    CREATE POLICY "Users can update own documents in storage"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can delete own documents in storage'
  ) THEN
    CREATE POLICY "Users can delete own documents in storage"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

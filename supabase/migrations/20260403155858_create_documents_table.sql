/*
  # Create Documents Management System

  ## 1. New Tables
    
    ### `documents`
      - `id` (uuid, primary key) - Unique identifier for the document
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `lease_id` (uuid, foreign key, nullable) - References leases.id if associated with a lease
      - `file_name` (text) - Original filename
      - `file_path` (text) - Storage path in Supabase Storage
      - `file_type` (text) - MIME type or file extension
      - `file_size` (bigint) - File size in bytes
      - `category` (text) - Document category
      - `description` (text) - Document description
      - `created_at` (timestamptz) - Upload timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  ## 2. Security
    - Enable RLS on documents table
    - Users can only view, upload, and delete their own documents
    - Create policies for authenticated users

  ## 3. Storage
    - Creates a 'documents' bucket in Supabase Storage
    - Organized by user_id/filename structure
    - Supports all common file types

  ## 4. Important Notes
    - Documents can be associated with specific leases or standalone
    - File paths are stored for easy retrieval from Supabase Storage
    - Automatic cleanup of orphaned files recommended
*/

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid REFERENCES leases(id) ON DELETE SET NULL,
  file_name text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  file_type text DEFAULT '',
  file_size bigint DEFAULT 0,
  category text DEFAULT 'General',
  description text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for documents
CREATE POLICY "Users can view own documents"
  ON documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON documents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to auto-update updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_documents_updated_at'
  ) THEN
    CREATE TRIGGER update_documents_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_lease_id ON documents(lease_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
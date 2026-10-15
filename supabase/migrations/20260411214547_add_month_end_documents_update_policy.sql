/*
  # Add missing UPDATE policy for month_end_documents

  1. Changes
    - Add UPDATE policy for month_end_documents table
    - This was the only missing CRUD policy — SELECT, INSERT, DELETE already existed
    - Without this policy, users could not update document status (e.g., marking as reviewed)

  2. Security
    - Restricts to authenticated owner only via auth.uid() = user_id
*/

CREATE POLICY "Users can update own month-end documents"
  ON month_end_documents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

/*
  # Add granular permissions column to user_profiles

  1. Modified Tables
    - `user_profiles`
      - Added `permissions` (jsonb) - Stores granular permission flags for the manage role
        - Default value is a JSON object with all manage-level permissions enabled

  2. Important Notes
    - Admin role ignores this column (has all permissions implicitly)
    - View role ignores this column (has only read permissions implicitly)
    - Only the manage role uses this column for fine-grained access control
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'permissions'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN permissions jsonb DEFAULT '{
      "create_edit_leases": true,
      "delete_leases": true,
      "create_transactions": true,
      "run_month_end": true,
      "manage_modifications": true,
      "upload_documents": true,
      "manage_user_roles": false,
      "access_user_management": false
    }'::jsonb;
  END IF;
END $$;
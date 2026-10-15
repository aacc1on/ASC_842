/*
  # Add view permissions to user_profiles permissions column

  1. Modified Tables
    - `user_profiles`
      - Updated `permissions` column default to include:
        - `view_leases_transactions` (default true)
        - `view_reports_documents` (default true)

  2. Important Notes
    - Existing rows with permissions already set will retain their values
    - Only the column default is updated for new rows
*/

ALTER TABLE user_profiles 
ALTER COLUMN permissions SET DEFAULT '{
  "view_leases_transactions": true,
  "view_reports_documents": true,
  "create_edit_leases": true,
  "delete_leases": true,
  "create_transactions": true,
  "run_month_end": true,
  "manage_modifications": true,
  "upload_documents": true,
  "manage_user_roles": false,
  "access_user_management": false
}'::jsonb;
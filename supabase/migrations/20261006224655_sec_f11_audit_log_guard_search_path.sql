/*
# F11 - Pin the search path on the audit log guard

1. Problem
   `internal.prevent_audit_log_mutation()` is the trigger that keeps the audit
   log append-only, but unlike every sibling guard it had no fixed
   `search_path`, so object resolution inside it depended on the caller's
   session setting. Reported by the database linter as
   `function_search_path_mutable`.

2. Changes
   - Set `search_path = ''` on the function.

3. Security
   - The integrity guard can no longer be influenced through the caller's
     search path.
*/

ALTER FUNCTION internal.prevent_audit_log_mutation() SET search_path = '';

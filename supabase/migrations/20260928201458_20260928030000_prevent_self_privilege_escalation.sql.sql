-- Prevent non-admin authenticated users from changing their own role/permissions.
-- Admins, service_role, and unauthenticated contexts (signup trigger / SQL editor) are exempt.

CREATE OR REPLACE FUNCTION internal.enforce_role_permissions_guard()
RETURNS TRIGGER AS $$
DECLARE
  caller_uid uuid := auth.uid();
  is_srv_role boolean := (SELECT auth.role() = 'service_role');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.permissions IS DISTINCT FROM OLD.permissions) THEN
      IF caller_uid IS NULL THEN
        RETURN NEW;
      END IF;
      IF is_srv_role THEN
        RETURN NEW;
      END IF;
      IF internal.is_admin() THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'You do not have permission to change role or permissions';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF caller_uid IS NOT NULL AND NOT is_srv_role AND NOT internal.is_admin() THEN
      NEW.role := 'view';
      NEW.permissions := '{"create_edit_leases": true, "delete_leases": true, "create_transactions": true, "run_month_end": true, "manage_modifications": true, "upload_documents": true, "manage_user_roles": false, "access_user_management": false}'::jsonb;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Attach the trigger
DROP TRIGGER IF EXISTS enforce_role_permissions_guard ON public.user_profiles;
CREATE TRIGGER enforce_role_permissions_guard
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION internal.enforce_role_permissions_guard();

-- Revoke direct execution from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION internal.enforce_role_permissions_guard() FROM public, anon, authenticated;

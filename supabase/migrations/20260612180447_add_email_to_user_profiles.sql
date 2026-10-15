-- Add email column to user_profiles, populate it from auth.users,
-- and update the trigger to capture email on new user creation.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text DEFAULT '';

-- Backfill existing rows
UPDATE user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.user_id = au.id
  AND (up.email IS NULL OR up.email = '');

-- Update the trigger to also store email
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Also sync email on any auth.users update (e.g. email change)
CREATE OR REPLACE FUNCTION sync_user_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.user_profiles
    SET email = NEW.email
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_updated_email'
  ) THEN
    CREATE TRIGGER on_auth_user_updated_email
      AFTER UPDATE ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_profile_email();
  END IF;
END $$;

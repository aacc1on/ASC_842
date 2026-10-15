/*
  # Create User Profiles and Activity Logs Tables

  ## 1. New Tables
    
    ### `user_profiles`
      - `id` (uuid, primary key) - Unique identifier for the profile
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `full_name` (text) - User's full name
      - `phone_number` (text) - User's phone number
      - `company_name` (text) - Company name
      - `job_title` (text) - Job title
      - `theme` (text) - UI theme preference (light, dark, auto)
      - `date_format` (text) - Date format preference
      - `currency` (text) - Currency preference
      - `timezone` (text) - Timezone preference
      - `language` (text) - Language preference
      - `email_notifications` (boolean) - Email notification setting
      - `lease_expiry_alerts` (boolean) - Lease expiry alert setting
      - `payment_reminders` (boolean) - Payment reminder setting
      - `monthly_reports` (boolean) - Monthly report setting
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
    
    ### `user_activity_logs`
      - `id` (uuid, primary key) - Unique identifier for the log entry
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `activity_type` (text) - Type of activity
      - `activity_description` (text) - Description of the activity
      - `ip_address` (text) - IP address of the user
      - `user_agent` (text) - Browser/device information
      - `created_at` (timestamptz) - Activity timestamp

  ## 2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage their own data
    - Users can only view and modify their own profile
    - Users can only view their own activity logs
    - Activity logs are insert-only for security

  ## 3. Important Notes
    - Profiles are automatically created for new users via trigger
    - Default preferences are set for new profiles
    - Activity logs track all important user actions
*/

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text DEFAULT '',
  phone_number text DEFAULT '',
  company_name text DEFAULT '',
  job_title text DEFAULT '',
  theme text DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  date_format text DEFAULT 'MM/DD/YYYY' CHECK (date_format IN ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')),
  currency text DEFAULT 'USD',
  timezone text DEFAULT 'America/New_York',
  language text DEFAULT 'en',
  email_notifications boolean DEFAULT true,
  lease_expiry_alerts boolean DEFAULT true,
  payment_reminders boolean DEFAULT true,
  monthly_reports boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Create user_activity_logs table
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL DEFAULT '',
  activity_description text NOT NULL DEFAULT '',
  ip_address text DEFAULT '',
  user_agent text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for user_activity_logs
CREATE POLICY "Users can view own activity logs"
  ON user_activity_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity logs"
  ON user_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Function to automatically create user profile
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION create_user_profile();
  END IF;
END $$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_profiles_updated_at'
  ) THEN
    CREATE TRIGGER update_user_profiles_updated_at
      BEFORE UPDATE ON user_profiles
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at DESC);
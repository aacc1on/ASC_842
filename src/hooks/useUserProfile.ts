import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getErrorMessage, isCaptchaError } from '../utils/errors';
import type { UserProfile, ActivityLog } from '../components/user/types';

interface UseUserProfileArgs {
  setError: (msg: string) => void;
  setSaveSuccess: (v: boolean) => void;
}

interface UseUserProfileResult {
  loadUserData: () => Promise<void>;
  profile: UserProfile | null;
  loading: boolean;
  activityLogs: ActivityLog[];
  updateProfile: <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => void;
  handleSaveProfile: () => Promise<void>;
  saving: boolean;
  passwordModal: boolean;
  setPasswordModal: (v: boolean) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  currentPassword: string;
  setCurrentPassword: (v: string) => void;
  handlePasswordChange: (captchaToken: string) => Promise<void>;
  logActivity: (type: string, description: string) => Promise<void>;
}

export function useUserProfile({ setError, setSaveSuccess }: UseUserProfileArgs): UseUserProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  const loadUserData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setError('Failed to load user session');
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError || !profileData) {
        setError('Failed to load profile');
        return;
      }

      const loaded: UserProfile = {
        user_id: profileData.user_id,
        email: profileData.email || user.email || '',
        full_name: profileData.full_name || '',
        phone_number: profileData.phone_number || '',
        company_name: profileData.company_name || '',
        job_title: profileData.job_title || '',
        theme: profileData.theme || 'light',
        date_format: profileData.date_format || 'MM/DD/YYYY',
        currency: profileData.currency || 'USD',
        timezone: profileData.timezone || 'America/New_York',
        language: profileData.language || 'en',
        email_notifications: profileData.email_notifications ?? true,
        lease_expiry_alerts: profileData.lease_expiry_alerts ?? true,
        payment_reminders: profileData.payment_reminders ?? true,
        monthly_reports: profileData.monthly_reports ?? false,
        role: profileData.role || 'view',
        permissions: profileData.permissions || null,
        created_at: profileData.created_at,
      };
      setProfile(loaded);

      const orgId = profileData.organization_id;
      const { data: logs, error: logsError } = await supabase
        .from('user_activity_logs')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!logsError && logs) {
        setActivityLogs(logs as ActivityLog[]);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const updateProfile = useCallback(<K extends keyof UserProfile>(field: K, value: UserProfile[K]) => {
    setProfile((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const logActivity = useCallback(async (activityType: string, description: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: inserted, error } = await supabase
        .from('user_activity_logs')
        .insert({
          user_id: user.id,
          activity_type: activityType,
          activity_description: description,
          ip_address: '',
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        })
        .select('*')
        .single();

      if (!error && inserted) {
        setActivityLogs((prev) => [inserted as ActivityLog, ...prev].slice(0, 50));
      }
    } catch {
      // Activity logging is best-effort; never surface to the user.
    }
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updates = {
        full_name: profile.full_name,
        phone_number: profile.phone_number,
        company_name: profile.company_name,
        job_title: profile.job_title,
        theme: profile.theme,
        date_format: profile.date_format,
        currency: profile.currency,
        timezone: profile.timezone,
        language: profile.language,
        email_notifications: profile.email_notifications,
        lease_expiry_alerts: profile.lease_expiry_alerts,
        payment_reminders: profile.payment_reminders,
        monthly_reports: profile.monthly_reports,
      };

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      await logActivity('profile_update', 'Updated profile settings');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [profile, setError, setSaveSuccess, logActivity]);


  const handlePasswordChange = useCallback(async (captchaToken: string) => {
    setSaving(true);
    setError('');
    try {
      if (!currentPassword) throw new Error('Please enter your current password');
      if (!newPassword) throw new Error('Please enter a new password');
      if (newPassword.length < 12) throw new Error('Password must be at least 12 characters');
      if (newPassword !== confirmPassword) throw new Error('Passwords do not match');

      // Verify current password before updating
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Not authenticated');
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
        options: { captchaToken },
      });
      if (verifyError) throw isCaptchaError(verifyError) ? verifyError : new Error('Current password is incorrect');

      const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
      if (pwError) throw pwError;

      await logActivity('password_change', 'Changed account password');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setPasswordModal(false);
      setNewPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [currentPassword, newPassword, confirmPassword, setError, setSaveSuccess, logActivity]);

  return {
    loadUserData,
    profile,
    loading,
    activityLogs,
    updateProfile,
    handleSaveProfile,
    saving,
    passwordModal,
    setPasswordModal,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    currentPassword,
    setCurrentPassword,
    handlePasswordChange,
    logActivity,
  };
}

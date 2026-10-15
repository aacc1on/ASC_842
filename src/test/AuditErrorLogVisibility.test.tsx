import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ subscription: { unsubscribe: vi.fn() } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  },
}));

vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

import { useUserProfile } from '../hooks/useUserProfile';
import { UserView } from '../components/UserView';

function mockProfile(role: string) {
  const profile = {
    user_id: 'u1',
    email: 'admin@test.com',
    full_name: 'Admin User',
    role,
    permissions: {},
    company_name: '',
    job_title: '',
    phone_number: '',
    theme: 'light',
    date_format: 'MM/DD/YYYY',
    currency: 'USD',
    timezone: 'America/New_York',
    language: 'en',
    email_notifications: true,
    lease_expiry_alerts: true,
    payment_reminders: true,
    monthly_reports: false,
    created_at: '',
  };

  vi.mocked(useUserProfile).mockReturnValue({
    profile,
    loading: false,
    saving: false,
    activityLogs: [],
    newPassword: '',
    setNewPassword: vi.fn(),
    confirmPassword: '',
    setConfirmPassword: vi.fn(),
    passwordModal: false,
    setPasswordModal: vi.fn(),
    updateProfile: vi.fn(),
    handleSaveProfile: vi.fn(),
    handlePasswordChange: vi.fn(),
    loadUserData: vi.fn(),
    logActivity: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Audit and Error Log tabs — admin visibility', () => {
  it('shows Audit Log and Error Log tabs for admin users', async () => {
    mockProfile('admin');
    render(<UserView userEmail="admin@test.com" planKey="enterprise" />);

    await waitFor(() => {
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
      expect(screen.getByText('Error Log')).toBeInTheDocument();
    });
  });

  it('does not show Audit Log and Error Log tabs for view-only users', async () => {
    mockProfile('view');
    render(<UserView userEmail="viewer@test.com" planKey="enterprise" />);

    await waitFor(() => {
      expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
      expect(screen.queryByText('Error Log')).not.toBeInTheDocument();
    });
  });

  it('does not show Audit Log and Error Log tabs for manage users', async () => {
    mockProfile('manage');
    render(<UserView userEmail="manager@test.com" planKey="enterprise" />);

    await waitFor(() => {
      expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
      expect(screen.queryByText('Error Log')).not.toBeInTheDocument();
    });
  });
});

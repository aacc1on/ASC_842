import type { UserPermissions, UserRole } from '../../App';
import type { PlanKey, PlanFeature } from '../../utils/planFeatures';

export interface UserViewProps {
  userEmail: string;
  planKey: PlanKey;
  features?: Record<PlanFeature, boolean>;
}

/**
 * A managed user row as seen by an admin in the User Management tab.
 * `permissions` is stored as jsonb on `user_profiles`; we surface it as the
 * strongly-typed shape used elsewhere in the app.
 */
export interface ManagedUser {
  user_id: string;
  email: string;
  full_name: string;
  company_name: string;
  job_title: string;
  role: UserRole;
  permissions: UserPermissions;
  created_at: string;
}

/** State carried into the role-change confirmation modal. */
export interface RoleChangeModalState {
  user_id: string;
  email: string;
  full_name: string;
  currentRole: UserRole;
  newRole: UserRole;
}

/** The signed-in user's profile, mirrored from the `user_profiles` table. */
export interface UserProfile {
  user_id: string;
  email: string;
  full_name: string;
  phone_number: string;
  company_name: string;
  job_title: string;
  theme: string;
  date_format: string;
  currency: string;
  timezone: string;
  language: string;
  email_notifications: boolean;
  lease_expiry_alerts: boolean;
  payment_reminders: boolean;
  monthly_reports: boolean;
  role: UserRole;
  permissions: UserPermissions;
  created_at: string;
}

/** A row from `user_activity_logs`. */
export interface ActivityLog {
  id: string;
  user_id: string;
  activity_type: string;
  activity_description: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export const ROLE_CONFIG: Record<UserRole, { label: string; description: string }> = {
  admin: {
    label: 'Administrator',
    description: 'Full access including user management and all permissions.',
  },
  manage: {
    label: 'Manager',
    description: 'Can manage leases, transactions, and documents. No user management.',
  },
  view: {
    label: 'Viewer',
    description: 'Read-only access to leases, transactions, and documents.',
  },
};

export const DEFAULT_PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: false,
  access_user_management: false,
};

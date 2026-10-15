import type { UserPermissions, UserRole } from '../App';
import type { ManagedUser } from '../components/user/types';

export interface AddUserForm {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}

export interface EditUserForm {
  full_name: string;
  company_name: string;
  job_title: string;
  role: UserRole;
  permissions: UserPermissions;
  password: string;
}

const ADMIN_PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: true,
  access_user_management: true,
};

export const VIEW_PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: false,
  delete_leases: false,
  create_transactions: false,
  run_month_end: false,
  manage_modifications: false,
  upload_documents: false,
  manage_user_roles: false,
  access_user_management: false,
};

const MANAGE_PERMISSIONS: UserPermissions = {
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

export function permissionsForRole(role: UserRole): UserPermissions {
  if (role === 'admin') return { ...ADMIN_PERMISSIONS };
  if (role === 'view') return { ...VIEW_PERMISSIONS };
  return { ...MANAGE_PERMISSIONS };
}

export const EMPTY_ADD_FORM: AddUserForm = {
  email: '',
  password: '',
  full_name: '',
  role: 'view',
};

export function toManagedUser(row: Record<string, unknown>): ManagedUser {
  return {
    user_id: row.user_id as string,
    email: (row.email as string) || '',
    full_name: (row.full_name as string) || '',
    company_name: (row.company_name as string) || '',
    job_title: (row.job_title as string) || '',
    role: (row.role as UserRole) || 'view',
    permissions: (row.permissions as UserPermissions) || { ...VIEW_PERMISSIONS },
    created_at: (row.created_at as string) || '',
  };
}

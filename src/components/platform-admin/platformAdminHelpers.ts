import { planDisplayName } from '../../utils/planFeatures';
import type { UserRole } from '../../App';

export interface PlatformUser {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  organization_id: string | null;
  org_name: string | null;
  plan_key: string | null;
  plan_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
  terms_version?: string | null;
  terms_accepted_at?: string | null;
}

export interface LegalAcceptanceRow {
  user_id: string;
  terms_version: string;
  terms_accepted_at: string;
}

export interface EditState {
  user: PlatformUser;
  fullName: string;
  role: UserRole;
  showPassword: boolean;
  newPassword: string;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function resolvePlanLabel(planKey: string | null, status: string | null): string {
  if (!planKey && !status) return 'No subscription';
  if (status === 'trialing') return 'Free Trial';
  if (status === 'expired') return 'Trial expired';
  if (planKey) {
    const display = planDisplayName(planKey as 'starter' | 'professional' | 'enterprise');
    return status === 'past_due' ? `${display} (past due)` : display;
  }
  return status || 'Unknown';
}

export function planBadgeClass(planKey: string | null, status: string | null): string {
  if (!planKey && !status) return 'bg-slate-100 text-slate-600 border-slate-200';
  if (status === 'trialing') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'expired') return 'bg-red-50 text-red-700 border-red-200';
  if (planKey === 'enterprise') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (planKey === 'professional') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (planKey === 'starter') return 'bg-slate-100 text-slate-600 border-slate-200';
  if (status === 'past_due') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (role === 'manage') return 'bg-cyan-50 text-cyan-700 border-cyan-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function filterPlatformUsers(users: PlatformUser[], search: string): PlatformUser[] {
  const q = search.toLowerCase().trim();
  if (!q) return users;
  return users.filter((u) =>
    u.email?.toLowerCase().includes(q) ||
    u.full_name?.toLowerCase().includes(q) ||
    u.org_name?.toLowerCase().includes(q) ||
    u.role?.toLowerCase().includes(q) ||
    u.plan_key?.toLowerCase().includes(q)
  );
}

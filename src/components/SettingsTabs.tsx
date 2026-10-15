import { NavLink } from 'react-router-dom';
import { ShieldCheck, Stamp, Stethoscope } from 'lucide-react';

const TABS = [
  { to: '/settings/accounting-policies', label: 'Accounting Policies', icon: ShieldCheck, adminOnly: false },
  { to: '/settings/approval', label: 'Approval', icon: Stamp, adminOnly: false },
  { to: '/settings/data-health', label: 'Data health', icon: Stethoscope, adminOnly: true },
];

export function SettingsTabs({ pendingCount = 0, isAdmin = false }: { pendingCount?: number; isAdmin?: boolean }) {
  return (
    <nav className="flex gap-1 border-b border-slate-200" aria-label="Settings sections">
      {TABS.filter((t) => isAdmin || !t.adminOnly).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`
          }
        >
          <Icon className="w-4 h-4" />
          {label}
          {to === '/settings/approval' && pendingCount > 0 && (
            <span className="ml-1 min-w-[20px] px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-xs leading-none text-center">
              {pendingCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

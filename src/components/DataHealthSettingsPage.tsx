import { Lock } from 'lucide-react';
import type { UserRole } from '../App';
import { SettingsTabs } from './SettingsTabs';
import { DataHealthPanel } from './LedgerHealthPanels';

export function DataHealthSettingsPage({ userRole }: { userRole: UserRole }) {
  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <SettingsTabs isAdmin={userRole === 'admin'} />
      {userRole === 'admin' ? (
        <DataHealthPanel scope="organization" />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <Lock className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h2 className="font-bold text-slate-900">Admins only</h2>
          <p className="text-sm text-slate-500 mt-1">Ask an administrator of your organization to review the data health check.</p>
        </div>
      )}
    </div>
  );
}

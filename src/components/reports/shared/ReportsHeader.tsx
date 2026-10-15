import { type ReportsTab } from '../types';
import { X, BarChart3, Building2, Calendar, ShieldCheck, Bell } from 'lucide-react';

interface ReportsHeaderProps {
  onClose?: () => void;
  activeTab: ReportsTab;
  setActiveTab: (tab: ReportsTab) => void;
}

export function ReportsHeader({ onClose, activeTab, setActiveTab }: ReportsHeaderProps) {
  return (
    <>
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 px-6 py-5 flex items-center justify-between">
        <div className="absolute inset-y-0 right-0 w-1/2 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, rgba(59,130,246,0.6), transparent 60%)' }}></div>
        <div className="relative flex items-center gap-3">
          <div className="bg-white/10 backdrop-blur-sm p-2.5 rounded-xl ring-1 ring-white/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Lease Portfolio Reports</h2>
            <p className="text-blue-200 text-sm">ASC 842 Compliance Summary</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close reports" className="relative text-white hover:bg-white/10 p-2 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        )}
      </div>

      <div className="border-b border-slate-200 px-6 bg-gradient-to-b from-slate-50 to-white">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-5 py-3.5 text-sm font-semibold transition-colors relative ${activeTab === 'portfolio' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Portfolio Overview
            </div>
            {activeTab === 'portfolio' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600 rounded-t-full"></div>}
          </button>
          <button
            onClick={() => setActiveTab('financial')}
            className={`px-5 py-3.5 text-sm font-semibold transition-colors relative ${activeTab === 'financial' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Financial Reports
            </div>
            {activeTab === 'financial' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600 rounded-t-full"></div>}
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-5 py-3.5 text-sm font-semibold transition-colors relative ${activeTab === 'compliance' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Compliance
            </div>
            {activeTab === 'compliance' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600 rounded-t-full"></div>}
          </button>
          <button
            onClick={() => setActiveTab('expiration')}
            className={`px-5 py-3.5 text-sm font-semibold transition-colors relative ${activeTab === 'expiration' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Contract Expiration
            </div>
            {activeTab === 'expiration' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600 rounded-t-full"></div>}
          </button>
          <button
            onClick={() => setActiveTab('payment_reminder')}
            className={`px-5 py-3.5 text-sm font-semibold transition-colors relative ${activeTab === 'payment_reminder' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Payment Reminders
            </div>
            {activeTab === 'payment_reminder' && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600 rounded-t-full"></div>}
          </button>
        </div>
      </div>
    </>
  );
}

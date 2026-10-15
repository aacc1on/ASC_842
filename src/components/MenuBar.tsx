import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, BarChart3, FolderOpen, User, LogOut, Receipt, CreditCard as Edit3, Crown, Settings, Eye, Building2, Plus, ChevronDown, X, CreditCard, ShieldCheck, Shield, Users, Menu } from 'lucide-react';
import type { UserRole, UserPermissions } from '../App';
import type { Company } from '../types/lease';
import { useCompanies } from '../hooks/useCompanies';
import { hasFeature, type PlanKey, type PlanFeature } from '../utils/planFeatures';

interface MenuBarProps {
  onLogout: () => void;
  userEmail: string;
  userRole: UserRole;
  permissions: UserPermissions;
  isPlatformAdmin?: boolean;
  companies: Company[];
  selectedCompanyId: string | null;
  onCompanyChange: (companyId: string | null) => void;
  onCompaniesUpdated: () => void;
  planKey: PlanKey;
  features?: Record<PlanFeature, boolean>;
  pendingApprovals?: number;
}

export function MenuBar({ onLogout, userEmail, userRole, permissions, isPlatformAdmin, companies, selectedCompanyId, onCompanyChange, onCompaniesUpdated, planKey, features, pendingApprovals = 0 }: MenuBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyCode, setNewCompanyCode] = useState('');
  const [addingCompany, setAddingCompany] = useState(false);
  const { handleAddCompany: addCompanyViaHook } = useCompanies();

  const [mobileOpen, setMobileOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const menuItems = [
    { id: 'leases' as const, label: 'Lease Accounting', icon: FileText, visible: permissions.view_leases_transactions },
    { id: 'transactions' as const, label: 'Transactions', icon: Receipt, visible: permissions.view_leases_transactions },
    { id: 'modifications' as const, label: 'Modifications', icon: Edit3, visible: (features?.contract_modifications ?? hasFeature(planKey, 'contract_modifications')) && (permissions.manage_modifications || permissions.view_leases_transactions) },
    { id: 'documents' as const, label: 'Documents', icon: FolderOpen, visible: permissions.view_reports_documents },
    { id: 'lessors' as const, label: 'Lessors', icon: Users, visible: permissions.view_leases_transactions },
    { id: 'reports' as const, label: 'Reports', icon: BarChart3, visible: permissions.view_reports_documents },
    { id: 'billing' as const, label: 'Billing', icon: CreditCard, visible: true },
    { id: 'settings/accounting-policies' as const, label: 'Settings', icon: ShieldCheck, visible: userRole === 'admin' || userRole === 'manage' },
    { id: 'user' as const, label: 'User', icon: User, visible: true },
    { id: 'admin' as const, label: 'Platform Admin', icon: Shield, visible: isPlatformAdmin },
  ];

  const roleDisplay = {
    admin: { label: 'Admin', icon: Crown, className: 'text-red-600' },
    manage: { label: 'Manage', icon: Settings, className: 'text-blue-600' },
    view: { label: 'View Only', icon: Eye, className: 'text-slate-500' },
  };

  const currentRole = roleDisplay[userRole];
  const RoleIcon = currentRole.icon;
  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return;
    setAddingCompany(true);
    const ok = await addCompanyViaHook(newCompanyName, newCompanyCode);
    if (ok) {
      setNewCompanyName('');
      setNewCompanyCode('');
      setShowAddCompany(false);
      onCompaniesUpdated();
    }
    setAddingCompany(false);
  };

  const closeMobile = () => {
    setMobileOpen(false);
    hamburgerRef.current?.focus();
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const handleNavClick = (id: string) => {
    navigate('/' + id);
    closeMobile();
  };

  const sidebarContent = (
    <>
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <span className="text-xl font-extrabold text-slate-950 tracking-tight">Lease Accountant</span>
        </div>
      </div>

      {/* Company Selector */}
      <div className="px-3 pt-4 pb-2 border-b border-slate-100">
        <div className="relative">
          <button
            onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
            aria-label="Select company"
            aria-expanded={showCompanyDropdown}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors text-left"
          >
            <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="flex-1 truncate text-sm font-semibold text-slate-900">
              {selectedCompany ? selectedCompany.company_name : companies.length === 0 ? 'No Company' : 'All Companies'}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showCompanyDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showCompanyDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                <button
                  onClick={() => { onCompanyChange(null); setShowCompanyDropdown(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${!selectedCompanyId ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700'}`}
                >
                  All Companies
                </button>
                {companies.map(company => (
                  <button
                    key={company.id}
                    onClick={() => { onCompanyChange(company.id); setShowCompanyDropdown(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${selectedCompanyId === company.id ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700'}`}
                  >
                    <span className="block truncate">{company.company_name}</span>
                    {company.company_code && (
                      <span className="text-xs text-slate-500">{company.company_code}</span>
                    )}
                  </button>
                ))}
              </div>
              {permissions.create_edit_leases && (
                <div className="border-t border-slate-100">
                  <button
                    onClick={() => { setShowAddCompany(true); setShowCompanyDropdown(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Company
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 py-4 px-3 overflow-y-auto">
        <nav className="space-y-2" aria-label="Main navigation">
          {menuItems.filter(item => item.visible).map((item) => {
            const Icon = item.icon;
            const isSettings = item.id === 'settings/accounting-policies';
            const isActive = location.pathname === '/' + item.id || (isSettings && location.pathname.startsWith('/settings'));
            const badge = isSettings ? pendingApprovals : 0;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-bold transition ${
                  isActive
                    ? 'bg-blue-700 text-white shadow-md'
                    : 'text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-bold tracking-tight">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={`ml-auto min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-bold text-center ${isActive ? 'bg-white text-blue-700' : 'bg-orange-500 text-white'}`}
                    aria-label={`${badge} pending approvals`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-4 px-2">
          <p className="text-sm font-bold text-slate-950 truncate">{userEmail}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <RoleIcon className={`w-3.5 h-3.5 ${currentRole.className}`} />
            <p className={`text-xs font-semibold ${currentRole.className}`}>{currentRole.label}</p>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-900 hover:bg-red-50 hover:text-red-700 rounded-lg transition"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </>
  );

  const addCompanyModal = (
    <>
      {showAddCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddCompany(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Add Company</h3>
              <button onClick={() => setShowAddCompany(false)} aria-label="Close add company dialog" className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Company Name *</label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Company Code</label>
                <input
                  type="text"
                  value={newCompanyCode}
                  onChange={(e) => setNewCompanyCode(e.target.value)}
                  placeholder="e.g. ACME"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowAddCompany(false)}
                className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCompany}
                disabled={!newCompanyName.trim() || addingCompany}
                className="px-4 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {addingCompany ? 'Adding...' : 'Add Company'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 shadow-sm flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-3">
          <button
            ref={hamburgerRef}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Menu className="w-6 h-6 text-slate-700" />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            <span className="text-base font-extrabold text-slate-950 tracking-tight">Lease Accountant</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <RoleIcon className={`w-3.5 h-3.5 ${currentRole.className}`} />
          <span className={`text-xs font-semibold ${currentRole.className}`}>{currentRole.label}</span>
        </div>
      </div>

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-white border-r border-slate-200 shadow-lg flex-col z-40" aria-label="Main navigation">
        {sidebarContent}
        {addCompanyModal}
      </nav>

      {/* Mobile off-canvas drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobile}
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-slide-in-left">
            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 lg:hidden">
              <span className="text-base font-extrabold text-slate-950">Menu</span>
              <button
                onClick={closeMobile}
                aria-label="Close menu"
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5 text-slate-700" />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      {addCompanyModal}
    </>
  );
}

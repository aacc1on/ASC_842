import { useEffect, useState, useCallback, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UpgradeCard } from './components/UpgradeCard';
import { SubscriptionBanner } from './components/SubscriptionBanner';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Auth } from './components/Auth';
import { MfaChallenge } from './components/MfaChallenge';
import { useMfaGate } from './hooks/useMfaGate';
import { MenuBar } from './components/MenuBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastContext';
import { useCompanies } from './hooks/useCompanies';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { Clock } from 'lucide-react';
import { fetchMyPlan, hasFeature, type MyPlan, type PlanKey } from './utils/planFeatures';
import { fetchPendingApprovals } from './utils/approvals';
import { LoadError } from './components/LoadError';
import { LegalPage, LegalLinks } from './components/legal/LegalPage';
import { LegalAcceptanceGate } from './components/legal/LegalAcceptanceGate';
import { useLegalStatus } from './hooks/useLegalStatus';
import { legalDocForPath } from './legal/paths';
import { lazyWithReload } from './utils/staleChunkReload';

const Dashboard = lazyWithReload(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const ReportsView = lazyWithReload(() => import('./components/ReportsView').then(m => ({ default: m.ReportsView })));
const DocumentsView = lazyWithReload(() => import('./components/DocumentsView').then(m => ({ default: m.DocumentsView })));
const UserView = lazyWithReload(() => import('./components/UserView').then(m => ({ default: m.UserView })));
const TransactionsView = lazyWithReload(() => import('./components/TransactionsView').then(m => ({ default: m.TransactionsView })));
const ModificationsModule = lazyWithReload(() => import('./components/ModificationsModule'));
const BillingView = lazyWithReload(() => import('./components/BillingView').then(m => ({ default: m.BillingView })));
const AccountingPoliciesPage = lazyWithReload(() => import('./components/AccountingPoliciesPage').then(m => ({ default: m.AccountingPoliciesPage })));
const LessorView = lazyWithReload(() => import('./components/LessorView').then(m => ({ default: m.LessorView })));
const ApprovalSettingsTab = lazyWithReload(() => import('./components/ApprovalSettingsTab').then(m => ({ default: m.ApprovalSettingsTab })));
const DataHealthSettingsPage = lazyWithReload(() => import('./components/DataHealthSettingsPage').then(m => ({ default: m.DataHealthSettingsPage })));
const PlatformAdminView = lazyWithReload(() => import('./components/PlatformAdminView').then(m => ({ default: m.PlatformAdminView })));

export type UserRole = 'admin' | 'manage' | 'view';

export interface UserPermissions {
  view_leases_transactions: boolean;
  view_reports_documents: boolean;
  create_edit_leases: boolean;
  delete_leases: boolean;
  create_transactions: boolean;
  run_month_end: boolean;
  manage_modifications: boolean;
  upload_documents: boolean;
  manage_user_roles: boolean;
  access_user_management: boolean;
}

const DEFAULT_PERMISSIONS: UserPermissions = {
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

const VIEW_PERMISSIONS: UserPermissions = {
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

function ViewLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>('view');
  const [userPermissions, setUserPermissions] = useState<UserPermissions>(VIEW_PERMISSIONS);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [platformAdminLoaded, setPlatformAdminLoaded] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [myPlan, setMyPlan] = useState<MyPlan | null>(null);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const refreshPendingApprovals = useCallback(() => {
    fetchPendingApprovals()
      .then(rows => setPendingApprovals(rows.length))
      .catch(() => setPendingApprovals(0));
  }, []);

  const { companies, selectedCompanyId, loaded: companiesLoaded, error: companiesError, loadCompanies, handleCompanyChange, reset: resetCompanies } = useCompanies();

  const loadUserRole = useCallback(async (userId: string, attempt = 0) => {
    const { data } = await supabase.from("user_profiles").select("role, permissions").eq("user_id", userId).maybeSingle();
    if (data?.role) {
      const role = data.role as UserRole;
      setUserRole(role);
      if (role === "admin") {
        setUserPermissions(ADMIN_PERMISSIONS);
      } else if (role === "view") {
        setUserPermissions(VIEW_PERMISSIONS);
      } else {
        setUserPermissions({ ...DEFAULT_PERMISSIONS, ...(data.permissions as Partial<UserPermissions> || {}) });
      }
    } else if (attempt < 3) {
      setTimeout(() => loadUserRole(userId, attempt + 1), 1000);
    }
  }, []);

  const loadPlatformAdminStatus = useCallback(async () => {
    const { data } = await supabase.rpc('is_platform_admin');
    setIsPlatformAdmin(data === true);
    setPlatformAdminLoaded(true);
  }, []);

  const loadMyPlan = useCallback(async () => {
    const plan = await fetchMyPlan();
    setMyPlan(plan);
    setSubscriptionLoaded(true);
  }, []);

  useEffect(() => {
    let didInit = false;

    const timeout = setTimeout(() => {
      if (!didInit) {
        didInit = true;
        setLoading(false);
      }
    }, 5000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSession(session);
        if (session?.user) {
          loadUserRole(session.user.id);
          loadPlatformAdminStatus();
          loadCompanies();
          loadMyPlan();
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUserRole('view');
        setUserPermissions(VIEW_PERMISSIONS);
        setIsPlatformAdmin(false);
        setPlatformAdminLoaded(false);
        resetCompanies();
        setMyPlan(null);
        setSubscriptionLoaded(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadUserRole(session.user.id);
        loadPlatformAdminStatus();
        loadCompanies();
        loadMyPlan();
      }
      if (!didInit) {
        didInit = true;
        setLoading(false);
      }
    }).catch(() => {
      if (!didInit) {
        didInit = true;
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [loadUserRole, loadPlatformAdminStatus, loadCompanies, loadMyPlan, resetCompanies]);


  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const { showWarning: showIdleWarning, dismissWarning: dismissIdleWarning } = useIdleTimeout(handleLogout);
  const mfaGate = useMfaGate(session?.user?.id ?? null);
  const legalGate = useLegalStatus(mfaGate.state === 'pass' ? session?.user?.id ?? null : null);

  const legalDoc = legalDocForPath(window.location.pathname);
  if (legalDoc) {
    return <LegalPage doc={legalDoc} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  if (isPasswordRecovery) {
    return <Auth showResetPassword />;
  }

  if (mfaGate.state === 'challenge' || mfaGate.state === 'error') {
    return <MfaChallenge gate={mfaGate} onSignOut={handleLogout} />;
  }

  if (mfaGate.state !== 'pass') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (legalGate.state === 'required' || legalGate.state === 'error') {
    return <LegalAcceptanceGate gate={legalGate} onSignOut={handleLogout} />;
  }

  if (legalGate.state !== 'pass') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  const planKey: PlanKey = myPlan?.plan_key ?? 'expired';
  const isSubscriptionActive = isPlatformAdmin || (myPlan !== null && planKey !== 'expired');
  const pastDueDaysRemaining = myPlan?.status === 'past_due' ? myPlan.days_left : null;

  const effectivePermissions = isSubscriptionActive ? userPermissions : { ...VIEW_PERMISSIONS };

  return (
    <BrowserRouter>
      <ToastProvider>
      <PendingPlanRedirect session={session} />
      <RouteChangeListener onChange={refreshPendingApprovals} />
        {showIdleWarning && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center">
              <Clock className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900 mb-2" id="idle-timeout-heading">Are you still there?</h3>
              <p className="text-sm text-slate-600 mb-5">You will be signed out in 2 minutes due to inactivity.</p>
              <button
                onClick={dismissIdleWarning}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
              >
                Stay signed in
              </button>
            </div>
          </div>
        )}
        <div className="min-h-screen bg-slate-50 flex">
          <MenuBar
            onLogout={handleLogout}
            userEmail={session.user.email || ''}
            userRole={userRole}
            permissions={userPermissions}
            isPlatformAdmin={isPlatformAdmin}
            companies={companies}
            selectedCompanyId={selectedCompanyId}
            onCompanyChange={handleCompanyChange}
            onCompaniesUpdated={loadCompanies}
            planKey={planKey}
            features={myPlan?.features}
            pendingApprovals={pendingApprovals}
          />

          <main className="lg:ml-64 flex-1 min-w-0 pt-14 lg:pt-0">
            {!companiesLoaded || !subscriptionLoaded || !platformAdminLoaded ? (
              <ViewLoader />
            ) : (
              <>
                {companiesError && (
                  <LoadError message={companiesError} onRetry={loadCompanies} className="m-4" />
                )}
                {!isSubscriptionActive && !isPlatformAdmin && (
                  <SubscriptionBanner
                    variant="inactive"
                    planKey={planKey}
                    daysLeft={myPlan?.days_left ?? null}
                    trialEndsAt={myPlan?.trial_ends_at ?? null}
                  />
                )}
                {isSubscriptionActive && pastDueDaysRemaining !== null && (
                  <SubscriptionBanner
                    variant="pastDue"
                    daysRemaining={pastDueDaysRemaining}
                  />
                )}
                <Suspense fallback={<ViewLoader />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/leases" replace />} />
                    <Route path="/leases" element={
                      <ErrorBoundary sectionName="Dashboard" onGoToDashboard={() => {}}>
                        <Dashboard userRole={userRole} permissions={effectivePermissions} selectedCompanyId={selectedCompanyId} planKey={planKey} features={myPlan?.features} />
                      </ErrorBoundary>
                    } />
                    <Route path="/transactions" element={
                      <ErrorBoundary sectionName="Transactions" onGoToDashboard={() => {}}>
                        <TransactionsView userRole={userRole} permissions={effectivePermissions} selectedCompanyId={selectedCompanyId} />
                      </ErrorBoundary>
                    } />
                    <Route path="/modifications" element={
                      <ErrorBoundary sectionName="Contract Modifications" onGoToDashboard={() => {}}>
                        {myPlan?.features.contract_modifications || hasFeature(planKey, 'contract_modifications')
                          ? <ModificationsModule userRole={userRole} permissions={effectivePermissions} selectedCompanyId={selectedCompanyId} />
                          : <UpgradeCard featureName="Contract Modifications" requiredPlan="Professional" description="Contract modifications, cancellations, and lease impairments are available on the Professional plan or higher." />
                        }
                      </ErrorBoundary>
                    } />
                    <Route path="/documents" element={
                      <ErrorBoundary sectionName="Documents" onGoToDashboard={() => {}}>
                        <DocumentsView userRole={userRole} permissions={effectivePermissions} selectedCompanyId={selectedCompanyId} />
                      </ErrorBoundary>
                    } />
                    <Route path="/lessors" element={
                      <ErrorBoundary sectionName="Lessors" onGoToDashboard={() => {}}>
                        <LessorView userRole={userRole} permissions={effectivePermissions} />
                      </ErrorBoundary>
                    } />
                    <Route path="/reports" element={
                      <ErrorBoundary sectionName="Reports" onGoToDashboard={() => {}}>
                        <ReportsView selectedCompanyId={selectedCompanyId} />
                      </ErrorBoundary>
                    } />
                    <Route path="/billing" element={
                      <ErrorBoundary sectionName="Billing" onGoToDashboard={() => {}}>
                        <BillingView myPlan={myPlan} />
                      </ErrorBoundary>
                    } />
                    <Route path="/settings/accounting-policies" element={
                      <ErrorBoundary sectionName="Accounting Policies" onGoToDashboard={() => {}}>
                        <AccountingPoliciesPage userRole={userRole} />
                      </ErrorBoundary>
                    } />
                    <Route path="/settings/approval" element={
                      <ErrorBoundary sectionName="Approval" onGoToDashboard={() => {}}>
                        <ApprovalSettingsTab userRole={userRole} onPendingChange={refreshPendingApprovals} />
                      </ErrorBoundary>
                    } />
                    <Route path="/settings/data-health" element={
                      <ErrorBoundary sectionName="Data health" onGoToDashboard={() => {}}>
                        <DataHealthSettingsPage userRole={userRole} />
                      </ErrorBoundary>
                    } />
                    <Route path="/user" element={
                      <ErrorBoundary sectionName="User Settings" onGoToDashboard={() => {}}>
                        <UserView userEmail={session.user.email || ''} planKey={planKey} features={myPlan?.features} />
                      </ErrorBoundary>
                    } />
                    {isPlatformAdmin && (
                      <Route path="/admin" element={
                        <ErrorBoundary sectionName="Platform Admin" onGoToDashboard={() => {}}>
                          <PlatformAdminView />
                        </ErrorBoundary>
                      } />
                    )}
                    <Route path="*" element={<Navigate to="/leases" replace />} />
                  </Routes>
                </Suspense>
              </>
            )}
            <footer className="px-6 py-6 text-xs text-slate-500 text-center">
              <LegalLinks />
            </footer>
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}

function PendingPlanRedirect({ session }: { session: Session | null }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!session?.user) return;
    if (location.pathname === '/billing') return;
    let pending: { plan_key: string; billing_cycle: 'monthly' | 'annually' } | null = null;
    try {
      const raw = localStorage.getItem('pendingPlan');
      if (raw) pending = JSON.parse(raw);
    } catch {
      return;
    }
    if (pending?.plan_key) {
      navigate('/billing?pending_plan=' + encodeURIComponent(pending.plan_key) + '&pending_cycle=' + encodeURIComponent(pending.billing_cycle), { replace: true });
    }
  }, [session, navigate, location.pathname]);

  return null;
}

function RouteChangeListener({ onChange }: { onChange: () => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange();
  }, [location.pathname, onChange]);
  return null;
}

export default App;

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease, ContractModification } from '../types/lease';
import { LeaseForm } from './LeaseForm';
import { AmortizationView } from './AmortizationView';
import { JournalEntriesView } from './JournalEntriesView';
import { LeaseList } from './LeaseList';
import { Pagination } from './Pagination';
import { batchCalculateCurrentBalances } from '../utils/currentBalances';
import { fetchPortfolioTotals, sumPortfolioTotals, type PortfolioTotals } from '../utils/portfolioTotals';
import { todayYmd } from '../utils/leaseLifecycle';
import { AlertCircle } from 'lucide-react';
import { LoadError } from './LoadError';
import { useAsyncData } from '../hooks/useAsyncData';
import { currentOrgId } from '../utils/currentOrg';
import { toUserMessage } from '../utils/errors';
import { useToast } from './toastContextTypes';
import type { UserRole, UserPermissions } from '../App';
import { hasFeature, type PlanKey, type PlanFeature } from '../utils/planFeatures';
import { useDashboardData } from '../hooks/useDashboardData';
import { LeaseDashboard } from './dashboard/LeaseDashboard';
import { useLeaseDashboardData } from '../hooks/useLeaseDashboardData';
import { LeaseToolbar } from './dashboard/LeaseToolbar';
import { LeaseFilters } from './dashboard/LeaseFilters';
import { DEFAULT_LEASE_SCOPE, type LeaseListScope } from './dashboard/leaseScope';
import { applyLeaseListFilters, groupModificationsByLease } from './dashboard/leaseListQuery';
import { FullscreenTable } from './dashboard/FullscreenTable';
import { SORT_CONFIG, DEFAULT_PAGE_SIZE } from './dashboard/types';
import type { SortOption, ViewMode } from './dashboard/types';

interface DashboardProps {
  userRole: UserRole;
  permissions: UserPermissions;
  selectedCompanyId?: string | null;
  planKey?: PlanKey;
  features?: Record<PlanFeature, boolean>;
}

export function Dashboard({ permissions, selectedCompanyId, userRole, planKey, features }: DashboardProps) {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | undefined>();
  const [viewingSchedule, setViewingSchedule] = useState<Lease | undefined>();
  const [viewingJournalEntries, setViewingJournalEntries] = useState<Lease | undefined>();

  const [filterLeaseType, setFilterLeaseType] = useState<'all' | 'operating' | 'finance'>('all');
  const [filterLessorType, setFilterLessorType] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [scope, setScope] = useState<LeaseListScope>(DEFAULT_LEASE_SCOPE);
  const [leaseLoadError, setLeaseLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [portfolioTotals, setPortfolioTotals] = useState<PortfolioTotals | null>(null);

  const [tableFullscreen, setTableFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('leasePortfolioViewMode') : null;
    return saved === 'table' || saved === 'kanban' || saved === 'cards' ? saved : 'cards';
  });
  useEffect(() => {
    window.localStorage.setItem('leasePortfolioViewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'table') setTableFullscreen(false);
  }, [viewMode]);

  useEffect(() => {
    if (!tableFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTableFullscreen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [tableFullscreen]);

  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('leasePortfolioSortBy') : null;
    return saved && saved in SORT_CONFIG ? (saved as SortOption) : 'created_desc';
  });
  useEffect(() => {
    window.localStorage.setItem('leasePortfolioSortBy', sortBy);
  }, [sortBy]);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A ref holds the latest lease-reload function so useDashboardData's
  // onDeleted callback (created during render) can call it without depending
  // on loadLeases, which is declared further down.
  const reloadLeasesRef = useRef<() => void>(() => {});

  const leaseDashboard = useLeaseDashboardData(selectedCompanyId);
  const { userId, leases, loading, error: deleteError, handleDelete, setLeases, setLoading } = useDashboardData({
    onUserError: () => showToast('error', 'Failed to get user information. Please refresh the page.'),
    onDeleted: () => {
      reloadLeasesRef.current();
      leaseDashboard.retry();
    },
  });

  const branchList = useAsyncData(async () => {
    const orgId = await currentOrgId();
    const { data, error } = await supabase
      .from('branches')
      .select('id, branch_name, branch_code')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('branch_name');
    if (error) throw error;
    return data ?? [];
  }, [], [] as { id: string; branch_name: string; branch_code: string | null }[], 'Failed to load branches.');

  const leaseRequest = useRef(0);

  useEffect(() => {
    const requests = leaseRequest;
    const debounce = searchDebounceRef;
    return () => {
      requests.current++;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);


  const loadLeases = useCallback(async (page: number, search: string, leaseType: string, lessorType: string, branchId: string, sort: SortOption, listScope: LeaseListScope) => {
    const request = ++leaseRequest.current;
    const isCurrent = () => request === leaseRequest.current;
    setLoading(true);
    setLeaseLoadError(null);

    try {
      const orgId = await currentOrgId();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let countQuery = supabase
        .from('leases')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);

      const sortCfg = SORT_CONFIG[sort];
      let dataQuery = supabase
        .from('leases')
        .select('*, fixed_asset_types:fixed_asset_type_id(type_name, type_code)')
        .eq('organization_id', orgId)
        .order(sortCfg.column, { ascending: sortCfg.ascending, nullsFirst: false })
        .range(from, to);

      if (sortCfg.column !== 'created_at') {
        dataQuery = dataQuery.order('created_at', { ascending: false });
      }
      dataQuery = dataQuery.order('id');

      const filters = { search, leaseType, lessorType, branchId, listScope, companyId: selectedCompanyId };
      const today = todayYmd();
      countQuery = applyLeaseListFilters(countQuery, filters, today);
      dataQuery = applyLeaseListFilters(dataQuery, filters, today);

      const [countResult, dataResult, totals] = await Promise.all([
        countQuery,
        dataQuery,
        fetchPortfolioTotals({
          companyId: selectedCompanyId,
          search,
          leaseType: leaseType as 'all' | 'operating' | 'finance',
          lessorType,
          branchId,
          status: listScope.status,
          missingClassificationOnly: listScope.missingClassificationOnly,
        }),
      ]);

      if (!isCurrent()) return;
      if (countResult.error) throw countResult.error;
      if (dataResult.error) throw dataResult.error;
      setTotalCount(countResult.count || 0);
      setPortfolioTotals(totals);

      const pageLeases = dataResult.data as Lease[];
      const balancesMap = await batchCalculateCurrentBalances(pageLeases);

      const [modsResult] = await Promise.all([
        supabase
          .from('contract_modifications')
          .select('id, lease_id, modification_date, modification_type, reason, old_monthly_payment, new_monthly_payment, old_lease_term, new_lease_term, old_discount_rate, new_discount_rate, accounting_treatment, status, approved_by, notes, created_at, old_rou_asset, new_rou_asset, old_lease_liability, new_lease_liability')
          .eq('organization_id', orgId)
          .in('lease_id', pageLeases.map((l) => l.id))
          .eq('status', 'approved'),
      ]);

      if (!isCurrent()) return;
      if (modsResult.error) throw modsResult.error;
      const modsByLease = groupModificationsByLease((modsResult.data || []) as ContractModification[]);

      const enriched = pageLeases.map((lease) => ({
        ...lease,
        modifications: modsByLease.get(lease.id) || [],
        currentBalances: balancesMap.get(lease.id),
      }));

      setLeases(enriched);
    } catch (err) {
      if (!isCurrent()) return;
      setLeases([]);
      setTotalCount(0);
      setPortfolioTotals(null);
      setLeaseLoadError(toUserMessage(err, 'Failed to load leases.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [pageSize, selectedCompanyId, setLeases, setLoading]);

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  useEffect(() => {
    loadLeases(currentPage, searchQueryRef.current, filterLeaseType, filterLessorType, filterBranch, sortBy, scope);
  }, [currentPage, pageSize, filterLeaseType, filterLessorType, filterBranch, sortBy, scope, loadLeases, selectedCompanyId]);

  // Keep the ref pointed at a function that reloads leases with current state.
  reloadLeasesRef.current = () => {
    loadLeases(currentPage, searchQueryRef.current, filterLeaseType, filterLessorType, filterBranch, sortBy, scope);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setCurrentPage(1);
      loadLeases(1, value, filterLeaseType, filterLessorType, filterBranch, sortBy, scope);
    }, 350);
  };

  const handleFilterChange = (leaseType: 'all' | 'operating' | 'finance', lessorType: string, branchId: string) => {
    setFilterLeaseType(leaseType);
    setFilterLessorType(lessorType);
    setFilterBranch(branchId);
    setCurrentPage(1);
    loadLeases(1, searchQuery, leaseType, lessorType, branchId, sortBy, scope);
  };

  const handleScopeChange = (next: LeaseListScope) => {
    setScope(next);
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setFilterLeaseType('all');
    setFilterLessorType('all');
    setFilterBranch('all');
    setScope(DEFAULT_LEASE_SCOPE);
    setSearchQuery('');
    setCurrentPage(1);
    loadLeases(1, '', 'all', 'all', 'all', sortBy, DEFAULT_LEASE_SCOPE);
  };

  const handleSortChange = (value: SortOption) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  const handleEdit = (lease: Lease) => {
    setEditingLease(lease);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingLease(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    reloadLeasesRef.current();
    leaseDashboard.retry();
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="sr-only">Lease Portfolio</h1>
        {deleteError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-700 font-medium">{deleteError}</p>
          </div>
        )}
        <LeaseDashboard
          data={leaseDashboard.data}
          loading={leaseDashboard.loading}
          error={leaseDashboard.error}
          onRetry={leaseDashboard.retry}
          onOpenLease={permissions.create_edit_leases ? handleEdit : setViewingSchedule}
        />

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <LeaseToolbar
            totalCount={totalCount}
            sortBy={sortBy}
            onSortChange={handleSortChange}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            canCreateEditLeases={permissions.create_edit_leases}
            onNewLease={() => setShowForm(true)}
            onEnterFullscreen={() => setTableFullscreen(true)}
          />

          <LeaseFilters
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            filterLeaseType={filterLeaseType}
            filterLessorType={filterLessorType}
            filterBranch={filterBranch}
            branches={branchList.data}
            leasesLength={leases.length}
            totalCount={totalCount}
            scope={scope}
            onScopeChange={handleScopeChange}
            scopeTotals={portfolioTotals ? sumPortfolioTotals(portfolioTotals) : null}
            onFilterChange={handleFilterChange}
            onClearFilters={handleClearFilters}
          />

          {branchList.error && (
            <LoadError message={branchList.error} onRetry={branchList.retry} className="mb-4" />
          )}
          {leaseLoadError ? (
            <LoadError message={leaseLoadError} onRetry={() => reloadLeasesRef.current()} />
          ) : loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-slate-500 mt-4">Loading leases...</p>
            </div>
          ) : (
            <>
              {!(tableFullscreen && viewMode === 'table') && (
                <LeaseList
                  leases={leases}
                  viewMode={viewMode}
                  portfolioTotals={portfolioTotals}
                  onEdit={permissions.create_edit_leases ? handleEdit : undefined}
                  onDelete={permissions.delete_leases ? handleDelete : undefined}
                  onViewSchedule={setViewingSchedule}
                  onViewJournalEntries={setViewingJournalEntries}
                  userRole={userRole}
                />
              )}

              {tableFullscreen && viewMode === 'table' && (
                <FullscreenTable
                  leases={leases}
                  onEdit={permissions.create_edit_leases ? handleEdit : undefined}
                  onDelete={permissions.delete_leases ? handleDelete : undefined}
                  onViewSchedule={setViewingSchedule}
                  onViewJournalEntries={setViewingJournalEntries}
                  onExit={() => setTableFullscreen(false)}
                />
              )}

              {totalCount > 0 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalCount}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  pageSizeOptions={[20, 50, 70]}
                />
              )}
            </>
          )}
        </div>
      </div>

      {showForm && (
        <LeaseForm
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
          lease={editingLease}
          userId={userId}
          selectedCompanyId={selectedCompanyId}
          canCreateBranch={features?.branches ?? (planKey ? hasFeature(planKey, 'branches') : true)}
        />
      )}

      {viewingSchedule && (
        <AmortizationView
          lease={viewingSchedule}
          onClose={() => setViewingSchedule(undefined)}
        />
      )}

      {viewingJournalEntries && (
        <JournalEntriesView
          lease={viewingJournalEntries}
          onClose={() => setViewingJournalEntries(undefined)}
        />
      )}
    </div>
  );
}

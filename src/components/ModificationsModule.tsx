import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  File as FileEdit, XCircle, CheckCircle, AlertCircle, Plus, Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { currentOrgId } from '../utils/currentOrg';
import { toUserMessage } from '../utils/errors';
import type { ModificationsModuleProps } from './modifications/types';
import { useModificationsData } from '../hooks/useModificationsData';
import { useModificationForm } from '../hooks/useModificationForm';
import { useModificationActions } from '../hooks/useModificationActions';
import { useImpairmentActions, type ImpairmentRow, type ImpairmentFormData } from '../hooks/useImpairmentActions';
import { ModificationsTable } from './modifications/ModificationsTable';
import { CancellationsTable } from './modifications/CancellationsTable';
import { ModificationFormModal } from './modifications/ModificationFormModal';
import { CancellationModal } from './modifications/CancellationModal';
import { ModificationDetailModal } from './modifications/ModificationDetailModal';
import { CancellationDetailModal } from './modifications/CancellationDetailModal';
import { ImpairmentFormModal } from './modifications/ImpairmentFormModal';

export default function ModificationsModule({ permissions, selectedCompanyId }: ModificationsModuleProps) {
  const [activeTab, setActiveTab] = useState<'modifications' | 'cancellations' | 'impairments'>('modifications');
  const [searchQuery, setSearchQuery] = useState('');
  const [modsPage, setModsPage] = useState(1);
  const [cansPage, setCansPage] = useState(1);
  const [impPage, setImpPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Impairment state
  const [impairments, setImpairments] = useState<ImpairmentRow[]>([]);
  const [showImpForm, setShowImpForm] = useState(false);
  const [impForm, setImpForm] = useState<ImpairmentFormData>({
    lease_id: '',
    impairment_date: new Date().toISOString().split('T')[0],
    impairment_amount: 0,
    reason: '',
  });

  const {
    leases, modifications, cancellations, loadData,
    loading, errorMessage, setErrorMessage,
    successMessage, setSuccessMessage,
  } = useModificationsData(selectedCompanyId);

  const {
    modForm, setModForm, canForm, setCanForm,
    showModForm, setShowModForm, showCanForm, setShowCanForm,
    selectedMod, setSelectedMod, selectedCan, setSelectedCan,
    editingMod, editingCan, preview, setPreview,
    canJournalEntries, canJournalLoading, canPreview,
    computePreview, refreshPreview,
    openEditMod, closeModForm, openEditCan, closeCanForm,
  } = useModificationForm(leases);

  const {
    handleModSubmit, handleCanSubmit, handleDelete,
  } = useModificationActions({
    leases, modForm, canForm,
    editingMod, editingCan, computePreview, loadData,
    setErrorMessage, setSuccessMessage, closeModForm, closeCanForm,
  });

  const { handleSubmit: handleImpSubmit, handleDelete: handleImpDelete } = useImpairmentActions({
    leases, loadData, setErrorMessage, setSuccessMessage,
    closeForm: () => setShowImpForm(false),
  });

  const loadImpairments = useCallback(async () => {
    try {
      const orgId = await currentOrgId();
      const { data, error } = await supabase
        .from('lease_impairments')
        .select(`
          id, lease_id, impairment_date, impairment_amount, reason, posted, status, created_at,
          leases:lease_id(lease_name)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data) {
        const rows: ImpairmentRow[] = (data as Record<string, unknown>[]).map((r) => ({
          id: r.id as string,
          lease_id: r.lease_id as string,
          impairment_date: r.impairment_date as string,
          impairment_amount: Number(r.impairment_amount) || 0,
          reason: (r.reason as string | null) ?? null,
          posted: Boolean(r.posted),
          status: String(r.status ?? ''),
          created_at: r.created_at as string,
          lease_name: (r.leases as Record<string, unknown> | null)?.lease_name as string | undefined,
        }));
        setImpairments(rows);
      }
    } catch (err) {
      setErrorMessage(toUserMessage(err, 'Failed to load impairments.'));
    }
  }, [setErrorMessage]);

  useEffect(() => {
    loadImpairments();
  }, [selectedCompanyId, loadImpairments]);

  const filteredMods = useMemo(() => modifications.filter(m =>
    [m.lease_name, m.reason, m.modification_type].some(s => s?.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [modifications, searchQuery]);
  const filteredCans = useMemo(() => cancellations.filter(c =>
    [c.lease_name, c.cancellation_reason].some(s => s?.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [cancellations, searchQuery]);
  const filteredImps = useMemo(() => impairments.filter(i =>
    [i.lease_name, i.reason].some(s => s?.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [impairments, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  const paginatedImps = filteredImps.slice((impPage - 1) * pageSize, impPage * pageSize);
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount || 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <FileEdit className="w-8 h-8 text-blue-600" />
              Contract Modifications
            </h1>
            <p className="text-slate-600 mt-1">Manage lease modifications, cancellations, and impairments</p>
          </div>
          {permissions.manage_modifications && (
            <div className="flex gap-3">
              <button
                onClick={() => { setPreview(null); setShowModForm(true); }}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold shadow-lg"
              >
                <Plus className="w-5 h-5" /> New Modification
              </button>
              <button
                onClick={() => setShowCanForm(true)}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold shadow-lg"
              >
                <XCircle className="w-5 h-5" /> Cancel Contract
              </button>
              <button
                onClick={() => {
                  setImpForm({ lease_id: '', impairment_date: new Date().toISOString().split('T')[0], impairment_amount: 0, reason: '' });
                  setShowImpForm(true);
                }}
                className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-semibold shadow-lg"
              >
                <AlertCircle className="w-5 h-5" /> Record Impairment
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        {errorMessage && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{errorMessage}</p>
            <button
              onClick={() => { setErrorMessage(''); loadData(); loadImpairments(); }}
              className="ml-auto px-3 py-1 text-sm font-medium bg-white border border-red-300 rounded-md hover:bg-red-100 transition-colors"
            >
              Retry
            </button>
            <button onClick={() => setErrorMessage('')} aria-label="Dismiss"><XCircle className="w-4 h-4" /></button>
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-6 py-4 rounded-lg flex items-center gap-3">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <p>{successMessage}</p>
            <button onClick={() => setSuccessMessage('')} className="ml-auto"><XCircle className="w-4 h-4" /></button>
          </div>
        )}

        {/* Main table card */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex gap-4 mb-6 border-b border-slate-200">
            {(['modifications', 'cancellations', 'impairments'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 font-semibold transition border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)} ({tab === 'modifications' ? modifications.length : tab === 'cancellations' ? cancellations.length : impairments.length})
              </button>
            ))}
          </div>

          <div className="mb-6 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by lease name, reason, or type..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setModsPage(1); setCansPage(1); setImpPage(1); }}
              className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {activeTab === 'modifications' ? (
            <ModificationsTable
              modifications={filteredMods}
              page={modsPage}
              pageSize={pageSize}
              onPageChange={setModsPage}
              onPageSizeChange={setPageSize}
              onView={setSelectedMod}
              onEdit={openEditMod}
              onDelete={(id) => handleDelete(id, 'modification')}
            />
          ) : activeTab === 'cancellations' ? (
            <CancellationsTable
              cancellations={filteredCans}
              page={cansPage}
              pageSize={pageSize}
              onPageChange={setCansPage}
              onPageSizeChange={setPageSize}
              onView={setSelectedCan}
              onEdit={openEditCan}
              onDelete={(id) => handleDelete(id, 'cancellation')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase">Lease</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase">Date</th>
                    <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase">Reason</th>
                    <th className="text-center px-4 py-3 text-xs font-bold text-slate-600 uppercase">Status</th>
                    <th className="text-center px-4 py-3 text-xs font-bold text-slate-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedImps.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No impairment records</td></tr>
                  )}
                  {paginatedImps.map((imp) => (
                    <tr key={imp.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{imp.lease_name || imp.lease_id}</td>
                      <td className="px-4 py-3 text-slate-600">{new Date(imp.impairment_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(imp.impairment_amount)}</td>
                      <td className="px-4 py-3 text-slate-600">{imp.reason || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {imp.posted
                          ? <span className="px-2 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800">Posted</span>
                          : imp.status === 'pending_approval'
                            ? <span className="px-2 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-800">Pending approval</span>
                            : <span className="px-2 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-700">{imp.status === 'draft' ? 'Returned' : 'Not posted'}</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {!imp.posted && (
                            <button
                                onClick={() => handleImpDelete(imp.id)}
                                className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                              >
                                Delete
                              </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredImps.length > pageSize && (
                <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Page {impPage} of {Math.ceil(filteredImps.length / pageSize)} — {filteredImps.length} record(s)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setImpPage(p => Math.max(1, p - 1))}
                      disabled={impPage === 1}
                      className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setImpPage(p => Math.min(Math.ceil(filteredImps.length / pageSize), p + 1))}
                      disabled={impPage >= Math.ceil(filteredImps.length / pageSize)}
                      className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* New/Edit Modification Modal */}
        <ModificationFormModal
          show={showModForm}
          editingMod={editingMod}
          leases={leases}
          modForm={modForm}
          setModForm={setModForm}
          preview={preview}
          canPreview={canPreview}
          onClose={closeModForm}
          onSubmit={handleModSubmit}
          onLeaseChange={(id) => {
            const l = leases.find(x => x.id === id);
            setPreview(null);
            setModForm(f => ({
              ...f,
              lease_id: id,
              ...(l ? {
                new_monthly_payment: l.payment_amount,
                new_lease_term: l.lease_term_months,
                new_discount_rate: l.discount_rate ?? l.incremental_borrowing_rate,
              } : {}),
            }));
          }}
          onDateChange={(date) => { setPreview(null); setModForm(f => ({ ...f, modification_date: date })); }}
          onPaymentChange={(value) => { setPreview(null); setModForm(f => ({ ...f, new_monthly_payment: value })); }}
          onTermChange={(value) => { setPreview(null); setModForm(f => ({ ...f, new_lease_term: value })); }}
          onRateChange={(value) => { setPreview(null); setModForm(f => ({ ...f, new_discount_rate: value })); }}
          onRefreshPreview={refreshPreview}
        />

        {/* Cancellation Modal */}
        <CancellationModal
          show={showCanForm}
          editingCan={editingCan}
          leases={leases}
          canForm={canForm}
          setCanForm={setCanForm}
          onClose={closeCanForm}
          onSubmit={handleCanSubmit}
        />

        {/* Impairment Modal */}
        {showImpForm && (
          <ImpairmentFormModal
            leases={leases}
            impForm={impForm}
            setImpForm={setImpForm}
            onClose={() => setShowImpForm(false)}
            onSubmit={handleImpSubmit}
          />
        )}

        {/* Modification Detail Modal */}
        <ModificationDetailModal
          modification={selectedMod}
          onClose={() => setSelectedMod(null)}
        />

        {/* Cancellation Detail Modal */}
        <CancellationDetailModal
          cancellation={selectedCan}
          journalEntries={canJournalEntries}
          journalLoading={canJournalLoading}
          onClose={() => setSelectedCan(null)}
        />
      </div>
    </div>
  );
}
